/*!
 * LMV v7.130.0
 *
 * Copyright 2026 Autodesk, Inc.
 * All rights reserved.
 *
 * This computer source code and related instructions and comments are the
 * unpublished confidential and proprietary information of Autodesk, Inc.
 * and are protected under Federal copyright and state trade secret law.
 * They may not be disclosed to, copied or used by any third party without
 * the prior written consent of Autodesk, Inc.
 *
 * Autodesk Viewer SDK Usage Limitations:
 *
 * The Autodesk Viewer SDK JavaScript must be delivered from an
 * Autodesk-hosted URL.
 */
/******/ (() => { // webpackBootstrap
/******/ 	// runtime can't be in strict mode because a global variable is assign and maybe created.
/******/ 	var __webpack_modules__ = ({

/***/ "./extensions/VirtualTextures/core/GPUTileAtlas.js"
/*!*********************************************************!*\
  !*** ./extensions/VirtualTextures/core/GPUTileAtlas.js ***!
  \*********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   GPUTileAtlas: () => (/* binding */ GPUTileAtlas)
/* harmony export */ });
/**
 * A fixed grid of GPU tile slots arranged in a square inside a single texture (the atlas).
 *
 * Pure device-side storage: it holds resident tile pixels (plus a 1px border around
 * each tile to prevent bleeding between neighbors) and knows nothing about residency
 * policy, eviction, or the page table. The owning cache decides which virtual tile
 * goes into which slot and supplies neighbor lookups for border maintenance.
 */
class GPUTileAtlas {

  /** @type {GPUDevice} */
  #device;

  /** @type {GPUTexture} Single texture containing all resident tiles in a grid. */
  #texture;

  /** @type {GPUTexture|null} Reusable staging texture for slot-to-slot border copies (WebGPU forbids same-texture copies). */
  #borderStagingTexture = null;

  /** @type {number} */
  #tileSize;

  /** @type {number} The pool is a square grid of #gridSize x #gridSize slots. */
  #gridSize;

  /** @type {number} Border size in pixels around each tile. */
  #borderSize;

  /**
   * @param {GPUDevice} device
   * @param {number} tileSize - Size of each tile in pixels (e.g., 256)
   * @param {number} gridSize - Number of tiles per row/column (e.g., 32 for an 8192px texture)
   * @param {number} [borderSize=1] - Border padding in pixels around each tile
   */
  constructor(device, tileSize = 256, gridSize = 32, borderSize = 1) {
    this.#device = device;
    this.#tileSize = tileSize;
    this.#borderSize = borderSize;

    // Each tile occupies (tileSize + 2*borderSize) so the border padding has room.
    const tileSizeWithBorder = tileSize + 2 * borderSize;

    // Clamp gridSize so the texture fits within the default WebGPU 8192px limit.
    const maxAtlasSize = 8192; // Default WebGPU maxTextureDimension2D
    const maxGridSize = Math.floor(maxAtlasSize / tileSizeWithBorder);
    this.#gridSize = Math.min(gridSize, maxGridSize);

    if (this.#gridSize < gridSize) {
      console.warn(`GPUTileAtlas: Reduced gridSize from ${gridSize} to ${this.#gridSize} to fit within texture size limit (${maxAtlasSize}px)`);
    }

    const atlasSize = tileSizeWithBorder * this.#gridSize;

    this.#texture = device.createTexture({
      label: 'GPUTileAtlas Texture',
      size: [atlasSize, atlasSize],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.RENDER_ATTACHMENT
    });
  }

  /** @returns {GPUTexture} The backing texture holding all tile slots. */
  get texture() {
    return this.#texture;
  }

  /** @returns {number} Grid size (tiles per row/column). */
  get gridSize() {
    return this.#gridSize;
  }

  /** @returns {number} Tile size in pixels. */
  get tileSize() {
    return this.#tileSize;
  }

  /** @returns {number} Border size in pixels. */
  get borderSize() {
    return this.#borderSize;
  }

  /**
   * Gets the minXY pixel position of a slot's tile content (inside its border).
   * @param {number} gridX - Grid column
   * @param {number} gridY - Grid row
   * @returns {{x: number, y: number}} Position in texture pixels
   */
  getTilePosition(gridX, gridY) {
    const tileSizeWithBorder = this.#tileSize + 2 * this.#borderSize;
    return {
      x: gridX * tileSizeWithBorder + this.#borderSize,
      y: gridY * tileSizeWithBorder + this.#borderSize
    };
  }

  /**
   * Writes a tile texture into the given slot, including border padding.
   * Borders are first filled from the tile's own edge pixels (clamp-to-edge default),
   * then overwritten by any cached virtual neighbors resolved via the callback.
   * @param {number} gridX - Grid column (0 to gridSize-1)
   * @param {number} gridY - Grid row (0 to gridSize-1)
   * @param {GPUTexture} sourceTexture - Source tile texture (must match tileSize)
   * @param {{level: number, x: number, y: number}} [tileCoord] - Virtual tile coords, enables neighbor borders
   * @param {function(number, number, number): {gridX: number, gridY: number}|null} [resolveNeighborSlot] - Maps (level, x, y) -> slot or null
   * @returns {boolean} True if written, false if the slot was out of bounds
   */
  writeTile(gridX, gridY, sourceTexture, tileCoord, resolveNeighborSlot) {
    if (gridX < 0 || gridX >= this.#gridSize || gridY < 0 || gridY >= this.#gridSize) {
      console.warn(`GPUTileAtlas: grid position (${gridX}, ${gridY}) out of bounds`);
      return false;
    }

    const tilePos = this.getTilePosition(gridX, gridY);

    // Step 1: Upload main tile content (centered in the bordered region)
    const mainEncoder = this.#device.createCommandEncoder({ label: 'tile upload main' });
    mainEncoder.copyTextureToTexture(
      { texture: sourceTexture },
      {
        texture: this.#texture,
        origin: [tilePos.x, tilePos.y, 0]
      },
      [this.#tileSize, this.#tileSize]
    );
    this.#device.queue.submit([mainEncoder.finish()]);

    // Step 2: Fill borders with own edge pixels (clamp-to-edge default).
    // Virtual neighbors will overwrite these in step 3 if they are already cached.
    const borderEncoder = this.#device.createCommandEncoder({ label: 'tile upload borders' });
    this.#fillBordersWithEdgePixels(gridX, gridY, sourceTexture, borderEncoder);
    this.#device.queue.submit([borderEncoder.finish()]);

    // Step 3: Update borders using virtual tile neighbors (not grid neighbors).
    this.#updateBordersFromVirtualNeighbors(gridX, gridY, tileCoord, sourceTexture, resolveNeighborSlot);

    return true;
  }

  /**
   * Fills borders with edge pixels from the source tile texture.
   * Always fills all borders as a default, which will be overwritten by adjacent tiles if they exist.
   * @param {number} gridX - Grid column
   * @param {number} gridY - Grid row
   * @param {GPUTexture} sourceTileTexture - Source tile texture to copy edge pixels from
   * @param {GPUCommandEncoder} encoder - Command encoder
   */
  #fillBordersWithEdgePixels(gridX, gridY, sourceTileTexture, encoder) {
    const tilePos = this.getTilePosition(gridX, gridY);
    const T = this.#tileSize;
    const B = this.#borderSize;
    const tex = this.#texture;

    // Replicate the tile's outermost edge texel outward across the full B-wide
    // border (clamp-to-edge). One 1px-thick copy per ring; virtual neighbors
    // overwrite the edges (not corners) in step 3 when they are cached.
    for (let b = 1; b <= B; b++) {
      // Left edge column -> left border
      encoder.copyTextureToTexture(
        { texture: sourceTileTexture, origin: [0, 0, 0] },
        { texture: tex, origin: [tilePos.x - b, tilePos.y, 0] },
        [1, T]);
      // Right edge column -> right border
      encoder.copyTextureToTexture(
        { texture: sourceTileTexture, origin: [T - 1, 0, 0] },
        { texture: tex, origin: [tilePos.x + T - 1 + b, tilePos.y, 0] },
        [1, T]);
      // Top edge row -> top border
      encoder.copyTextureToTexture(
        { texture: sourceTileTexture, origin: [0, 0, 0] },
        { texture: tex, origin: [tilePos.x, tilePos.y - b, 0] },
        [T, 1]);
      // Bottom edge row -> bottom border
      encoder.copyTextureToTexture(
        { texture: sourceTileTexture, origin: [0, T - 1, 0] },
        { texture: tex, origin: [tilePos.x, tilePos.y + T - 1 + b, 0] },
        [T, 1]);
    }

    // Corners: replicate each corner texel across the B x B diagonal block.
    // O(B^2) tiny copies, but B is small (<= 8) and tiles upload infrequently.
    for (let by = 1; by <= B; by++) {
      for (let bx = 1; bx <= B; bx++) {
        // Top-left
        encoder.copyTextureToTexture(
          { texture: sourceTileTexture, origin: [0, 0, 0] },
          { texture: tex, origin: [tilePos.x - bx, tilePos.y - by, 0] }, [1, 1]);
        // Top-right
        encoder.copyTextureToTexture(
          { texture: sourceTileTexture, origin: [T - 1, 0, 0] },
          { texture: tex, origin: [tilePos.x + T - 1 + bx, tilePos.y - by, 0] }, [1, 1]);
        // Bottom-left
        encoder.copyTextureToTexture(
          { texture: sourceTileTexture, origin: [0, T - 1, 0] },
          { texture: tex, origin: [tilePos.x - bx, tilePos.y + T - 1 + by, 0] }, [1, 1]);
        // Bottom-right
        encoder.copyTextureToTexture(
          { texture: sourceTileTexture, origin: [T - 1, T - 1, 0] },
          { texture: tex, origin: [tilePos.x + T - 1 + bx, tilePos.y + T - 1 + by, 0] }, [1, 1]);
      }
    }
  }

  /**
   * Returns a small reusable staging texture for slot-to-slot border copies.
   * WebGPU forbids copyTextureToTexture within the same texture, so we bounce through this.
   */
  #getBorderStagingTexture() {
    if (!this.#borderStagingTexture) {
      // Must fit both orientations: [borderSize, tileSize] and [tileSize, borderSize]
      this.#borderStagingTexture = this.#device.createTexture({
        label: 'GPUTileAtlas BorderStaging',
        size: [this.#tileSize, this.#tileSize],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
      });
    }
    return this.#borderStagingTexture;
  }

  /**
   * Copies a region within the pool texture via a staging texture (same-texture copy workaround).
   * @param {GPUCommandEncoder} encoder
   * @param {number[]} srcOrigin - [x, y, 0]
   * @param {number[]} dstOrigin - [x, y, 0]
   * @param {number[]} size - [width, height]
   */
  #copyWithinTexture(encoder, srcOrigin, dstOrigin, size) {
    const staging = this.#getBorderStagingTexture();
    encoder.copyTextureToTexture(
      { texture: this.#texture, origin: srcOrigin },
      { texture: staging, origin: [0, 0, 0] },
      size
    );
    encoder.copyTextureToTexture(
      { texture: staging, origin: [0, 0, 0] },
      { texture: this.#texture, origin: dstOrigin },
      size
    );
  }

  /**
   * Updates borders using virtual tile neighbors (not grid neighbors).
   * Bidirectional: copies neighbor edges into the current tile's borders AND the current
   * tile's edges into the neighbors' borders.
   * @param {number} gridX - Grid column of newly written tile
   * @param {number} gridY - Grid row of newly written tile
   * @param {{level: number, x: number, y: number}|undefined} tileCoord - Virtual tile coordinates (skip if not provided)
   * @param {GPUTexture} sourceTileTexture - Source tile texture to copy edge pixels from
   * @param {function(number, number, number): {gridX: number, gridY: number}|null} [resolveNeighborSlot] - Maps (level, x, y) -> slot or null
   */
  #updateBordersFromVirtualNeighbors(gridX, gridY, tileCoord, sourceTileTexture, resolveNeighborSlot) {
    if (!tileCoord || !resolveNeighborSlot) return;

    const { level, x, y } = tileCoord;
    const tilesPerAxis = 1 << level;
    const tilePos = this.getTilePosition(gridX, gridY);
    const encoder = this.#device.createCommandEncoder({ label: 'update virtual neighbor borders' });
    let needsUpdate = false;

    // Left virtual neighbor
    if (x > 0) {
      const slot = resolveNeighborSlot(level, x - 1, y);
      if (slot) {
        const nPos = this.getTilePosition(slot.gridX, slot.gridY);
        // Neighbor's rightmost B columns → current tile's left border (via staging)
        this.#copyWithinTexture(encoder,
        [nPos.x + this.#tileSize - this.#borderSize, nPos.y, 0],
        [tilePos.x - this.#borderSize, tilePos.y, 0],
        [this.#borderSize, this.#tileSize]
        );
        // Current tile's left edge → neighbor's right border
        encoder.copyTextureToTexture(
          { texture: sourceTileTexture, origin: [0, 0, 0] },
          { texture: this.#texture, origin: [nPos.x + this.#tileSize, nPos.y, 0] },
          [this.#borderSize, this.#tileSize]
        );
        needsUpdate = true;
      }
    }

    // Right virtual neighbor
    if (x < tilesPerAxis - 1) {
      const slot = resolveNeighborSlot(level, x + 1, y);
      if (slot) {
        const nPos = this.getTilePosition(slot.gridX, slot.gridY);
        // Neighbor's left edge → current tile's right border (via staging)
        this.#copyWithinTexture(encoder,
        [nPos.x, nPos.y, 0],
        [tilePos.x + this.#tileSize, tilePos.y, 0],
        [this.#borderSize, this.#tileSize]
        );
        // Current tile's rightmost B columns → neighbor's left border
        encoder.copyTextureToTexture(
          { texture: sourceTileTexture, origin: [this.#tileSize - this.#borderSize, 0, 0] },
          { texture: this.#texture, origin: [nPos.x - this.#borderSize, nPos.y, 0] },
          [this.#borderSize, this.#tileSize]
        );
        needsUpdate = true;
      }
    }

    // Top virtual neighbor
    if (y > 0) {
      const slot = resolveNeighborSlot(level, x, y - 1);
      if (slot) {
        const nPos = this.getTilePosition(slot.gridX, slot.gridY);
        // Neighbor's bottom B rows → current tile's top border (via staging)
        this.#copyWithinTexture(encoder,
        [nPos.x, nPos.y + this.#tileSize - this.#borderSize, 0],
        [tilePos.x, tilePos.y - this.#borderSize, 0],
        [this.#tileSize, this.#borderSize]
        );
        // Current tile's top edge → neighbor's bottom border
        encoder.copyTextureToTexture(
          { texture: sourceTileTexture, origin: [0, 0, 0] },
          { texture: this.#texture, origin: [nPos.x, nPos.y + this.#tileSize, 0] },
          [this.#tileSize, this.#borderSize]
        );
        needsUpdate = true;
      }
    }

    // Bottom virtual neighbor
    if (y < tilesPerAxis - 1) {
      const slot = resolveNeighborSlot(level, x, y + 1);
      if (slot) {
        const nPos = this.getTilePosition(slot.gridX, slot.gridY);
        // Neighbor's top edge → current tile's bottom border (via staging)
        this.#copyWithinTexture(encoder,
        [nPos.x, nPos.y, 0],
        [tilePos.x, tilePos.y + this.#tileSize, 0],
        [this.#tileSize, this.#borderSize]
        );
        // Current tile's bottom B rows → neighbor's top border
        encoder.copyTextureToTexture(
          { texture: sourceTileTexture, origin: [0, this.#tileSize - this.#borderSize, 0] },
          { texture: this.#texture, origin: [nPos.x, nPos.y - this.#borderSize, 0] },
          [this.#tileSize, this.#borderSize]
        );
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      this.#device.queue.submit([encoder.finish()]);
    }
    // No virtual neighbors: leave the encoder unfinished — it's GC'd without
    // producing an unused GPUCommandBuffer.
  }

  /**
   * Destroys the pool's GPU resources.
   */
  destroy() {
    this.#texture?.destroy();
    this.#texture = null;
    this.#borderStagingTexture?.destroy();
    this.#borderStagingTexture = null;
  }
}

/***/ },

/***/ "./extensions/VirtualTextures/core/TileFeedbackLoop.js"
/*!*************************************************************!*\
  !*** ./extensions/VirtualTextures/core/TileFeedbackLoop.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TileFeedbackLoop: () => (/* binding */ TileFeedbackLoop)
/* harmony export */ });
/* harmony import */ var _TileFeedbackProcessor_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./TileFeedbackProcessor.js */ "./extensions/VirtualTextures/core/TileFeedbackProcessor.js");
/* harmony import */ var _VirtualTextureCache_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./VirtualTextureCache.js */ "./extensions/VirtualTextures/core/VirtualTextureCache.js");



/**
 * Drives the feedback-driven tile-refine loop for one attached virtual texture.
 *
 * On each presented frame it: pushes the current viewport size to the cache, reads
 * back the GPU tile-feedback buffer (via a {@link TileFeedbackProcessor}), and
 * requests the tiles the GPU reported as visible. It also redraws whenever a newly
 * requested tile finishes uploading.
 *
 * Owns a TileFeedbackProcessor (the pure readback/dedup transform) and adds the
 * viewer/cache wiring plus lifecycle (start/stop). Keeping this here keeps the
 * extension's attach()/detach() thin and the TileFeedbackProcessor decoupled from
 * the viewer.
 */
class TileFeedbackLoop {

  /** @type {Autodesk.Viewing.Viewer3D} */
  #viewer;

  /** @type {import('./VirtualTextureCache.js').VirtualTextureCache} */
  #cache;

  /** @type {number} Max tile loads kicked off per frame. */
  #maxLoadsPerFrame;

  /** @type {TileFeedbackProcessor} The pure readback/dedup transform this loop drives. */
  #feedbackProcessor;

  /** @type {function} */
  #onRenderPresented;

  /** @type {function} */
  #onTileUploaded;

  /** @type {boolean} */
  #running = false;

  /**
   * @param {Autodesk.Viewing.Viewer3D} viewer
   * @param {import('./VirtualTextureCache.js').VirtualTextureCache} cache
   * @param {GPUDevice} device
   * @param {Object} [options]
   * @param {number} [options.maxLoadsPerFrame=8] - Max tile loads kicked off per frame.
   */
  constructor(viewer, cache, device, { maxLoadsPerFrame = 8 } = {}) {
    this.#viewer = viewer;
    this.#cache = cache;
    this.#maxLoadsPerFrame = maxLoadsPerFrame;
    this.#feedbackProcessor = new _TileFeedbackProcessor_js__WEBPACK_IMPORTED_MODULE_0__.TileFeedbackProcessor(device);
    this.#onRenderPresented = () => this.#step();
    this.#onTileUploaded = () => this.#viewer.impl.invalidate(true);
  }

  /** Start listening for presented frames and tile uploads. */
  start() {
    if (this.#running) {
      return;
    }
    this.#running = true;
    this.#cache.addEventListener(_VirtualTextureCache_js__WEBPACK_IMPORTED_MODULE_1__.TILE_UPLOADED_EVENT, this.#onTileUploaded);
    this.#viewer.addEventListener(Autodesk.Viewing.RENDER_PRESENTED_EVENT, this.#onRenderPresented);
  }

  /** Stop the loop, remove listeners, and release the TileFeedbackProcessor. */
  stop() {
    if (!this.#running) {
      return;
    }
    this.#running = false;
    this.#viewer.removeEventListener(Autodesk.Viewing.RENDER_PRESENTED_EVENT, this.#onRenderPresented);
    this.#cache.removeEventListener(_VirtualTextureCache_js__WEBPACK_IMPORTED_MODULE_1__.TILE_UPLOADED_EVENT, this.#onTileUploaded);
    this.#feedbackProcessor.destroy();
  }

  /**
   * One refine step: sample the feedback the GPU wrote this frame and request the
   * tiles it reported as visible. Redraws are triggered separately by the
   * tile-uploaded listener when new tiles arrive.
   */
  #step() {
    const canvas = this.#viewer.impl.canvas;
    if (canvas) {
      this.#cache.setViewportSize(canvas.width, canvas.height);
    }
    const feedbackBuffer = this.#cache.getFeedbackBuffer();
    if (feedbackBuffer) {
      this.#feedbackProcessor.submitSampleFromBuffer(feedbackBuffer, this.#cache.feedbackGridSize);
    }
    const tiles = this.#feedbackProcessor.getLatestResults();
    if (tiles.length > 0) {
      this.#cache.tick();
      this.#cache.requestTiles(tiles, this.#maxLoadsPerFrame);
    }
  }
}

/***/ },

/***/ "./extensions/VirtualTextures/core/TileFeedbackProcessor.js"
/*!******************************************************************!*\
  !*** ./extensions/VirtualTextures/core/TileFeedbackProcessor.js ***!
  \******************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   FEEDBACK_WORDS_PER_SLOT: () => (/* binding */ FEEDBACK_WORDS_PER_SLOT),
/* harmony export */   TileFeedbackProcessor: () => (/* binding */ TileFeedbackProcessor),
/* harmony export */   unpackFeedbackBuffer: () => (/* binding */ unpackFeedbackBuffer)
/* harmony export */ });
/**
 * TileFeedbackProcessor - Reads the tile feedback storage buffer and collects tile requests.
 *
 * The fragment shader (virtual_texture.wgsl) writes tile requests directly into a
 * read_write atomic storage buffer at feedback-grid resolution. This class copies that
 * buffer back to the CPU (double-buffered, non-blocking) and deduplicates the entries
 * into a prioritized list of tile requests.
 */

/**
 * Number of u32 words per feedback slot: [key, xFull, yFull].
 * MUST match virtual_texture.wgsl writeTileFeedback. The key selects the finest
 * level per cell via atomicMax; the full coords are stored as separate u32s,
 * supporting up to level 32 (the key alone would only embeds 13-bit x/y for compactness).
 */
const FEEDBACK_WORDS_PER_SLOT = 3;

/**
 * Unpacks a feedback buffer (CPU-side u32 view) into deduplicated, count-sorted
 * tile requests. Pure function (no GPU), so it is unit-testable against the same
 * packing the shader produces.
 *
 * Per slot [key, xFull, yFull]:
 *   key   = ((level+1) << 26) | ((tileY & 0x1FFF) << 13) | (tileX & 0x1FFF), 0 = empty
 * The full coords are the atomicMax winner's; a low-bit mismatch means a rare
 * atomic race clobbered them, so that slot is skipped (never a wrong request).
 *
 * @param {Uint32Array} data - CPU view of the feedback buffer
 * @param {number} slotCount - Number of feedback slots (grid cells × 2 for opaque + transparent)
 * @returns {Array<{level: number, tileX: number, tileY: number, count: number}>}
 */
function unpackFeedbackBuffer(data, slotCount) {
  const tileCounts = new Map();

  for (let s = 0; s < slotCount; s++) {
    const base = s * FEEDBACK_WORDS_PER_SLOT;
    const keyWord = data[base];
    if (keyWord === 0) continue; // empty slot

    const level = (keyWord >>> 26) - 1; // (level+1) stored in the top 6 bits
    const loY = keyWord >>> 13 & 0x1FFF;
    const loX = keyWord & 0x1FFF;

    const tileX = data[base + 1];
    const tileY = data[base + 2];

    // Race guard: full coords are published by the atomicMax winner, but a
    // coarser late writer can clobber them. If the low 13 bits don't match
    // the (correct) key, skip this cell for the frame — never request a
    // mismatched tile. Self-corrects next frame.
    if ((tileX & 0x1FFF) !== loX || (tileY & 0x1FFF) !== loY) continue;

    const key = `${level},${tileX},${tileY}`;
    tileCounts.set(key, (tileCounts.get(key) || 0) + 1);
  }

  const result = [];
  for (const [key, count] of tileCounts) {
    const [level, tileX, tileY] = key.split(',').map(Number);
    result.push({ level, tileX, tileY, count });
  }
  result.sort((a, b) => b.count - a.count);
  return result;
}

class TileFeedbackProcessor {
  /** @type {GPUDevice} */
  #device;

  /** @type {Array<{level: number, tileX: number, tileY: number, count: number}>} */
  #latestResults = [];

  // Double-buffered readback for async operation
  /** @type {GPUBuffer[]} */
  #bufferReadbackBuffers = [];

  /** @type {boolean[]} */
  #bufferReadbackInUse = [false, false];

  /** @type {number} */
  #bufferReadbackIndex = 0;

  /** @type {number} Last created readback buffer size (to detect resize) */
  #bufferReadbackSize = 0;

  /** @type {boolean} Set in destroy(); guards in-flight mapAsync callbacks against the destroyed buffers. */
  #destroyed = false;

  /**
   * @param {GPUDevice} device
   */
  constructor(device) {
    this.#device = device;
  }

  /**
   * Ensure readback buffers exist and match the expected size.
   * @param {number} byteSize
   */
  #ensureBufferReadbackBuffers(byteSize) {
    if (this.#bufferReadbackSize === byteSize && this.#bufferReadbackBuffers.length === 2) return;

    for (const buf of this.#bufferReadbackBuffers) buf?.destroy();
    this.#bufferReadbackBuffers = [];
    for (let i = 0; i < 2; i++) {
      this.#bufferReadbackBuffers.push(this.#device.createBuffer({
        label: `TileFeedbackProcessor BufferReadback ${i}`,
        size: byteSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
      }));
    }
    this.#bufferReadbackSize = byteSize;
    this.#bufferReadbackInUse = [false, false];
  }

  /**
   * Submit a non-blocking readback from the feedback storage buffer.
   * Results available via getLatestResults().
   *
   * Buffer layout: gridSize*gridSize cells, 2 slots each (opaque + transparent),
   * FEEDBACK_WORDS_PER_SLOT u32 per slot ([key, xFull, yFull]).
   *
   * @param {GPUBuffer} feedbackBuffer - The feedback storage buffer from VirtualTextureCache
   * @param {number} feedbackGridSize - Grid dimension (e.g. 128)
   */
  submitSampleFromBuffer(feedbackBuffer, feedbackGridSize) {
    // Each grid cell has two slots (opaque + transparent) — see writeTileFeedback in virtual_texture.wgsl.
    const slotCount = feedbackGridSize * feedbackGridSize * 2;
    const byteSize = slotCount * FEEDBACK_WORDS_PER_SLOT * 4;
    this.#ensureBufferReadbackBuffers(byteSize);

    const nextIndex = (this.#bufferReadbackIndex + 1) % 2;
    if (this.#bufferReadbackInUse[nextIndex]) return; // Both in use, skip frame

    this.#bufferReadbackIndex = nextIndex;
    const readbackBuffer = this.#bufferReadbackBuffers[this.#bufferReadbackIndex];

    const commandEncoder = this.#device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(feedbackBuffer, 0, readbackBuffer, 0, byteSize);
    commandEncoder.clearBuffer(feedbackBuffer);
    this.#device.queue.submit([commandEncoder.finish()]);

    const bufferIndex = this.#bufferReadbackIndex;
    this.#bufferReadbackInUse[bufferIndex] = true;

    readbackBuffer.mapAsync(GPUMapMode.READ).then(() => {
      // destroy() may have run while this mapAsync was pending; the buffer is
      // gone, so reading getMappedRange()/unmap() would be a use-after-destroy.
      if (this.#destroyed) return;
      this.#latestResults = this.#processBufferReadback(readbackBuffer, slotCount);
      readbackBuffer.unmap();
      this.#bufferReadbackInUse[bufferIndex] = false;
    }).catch((err) => {
      console.warn('TileFeedbackProcessor: Buffer readback failed', err);
      this.#bufferReadbackInUse[bufferIndex] = false;
    });
  }

  /**
   * Unpack the feedback storage buffer into deduplicated tile requests.
   * Merges both slots (opaque + transparent) into a single result list.
   * @param {GPUBuffer} buffer
   * @param {number} slotCount
   * @returns {Array<{level: number, tileX: number, tileY: number, count: number}>}
   */
  #processBufferReadback(buffer, slotCount) {
    const data = new Uint32Array(buffer.getMappedRange());
    return unpackFeedbackBuffer(data, slotCount);
  }

  /**
   * Get the latest completed tile request results.
   * @returns {Array<{level: number, tileX: number, tileY: number, count: number}>}
   */
  getLatestResults() {
    return this.#latestResults;
  }

  /**
   * Destroy resources.
   */
  destroy() {
    this.#destroyed = true;
    for (const buffer of this.#bufferReadbackBuffers) {
      buffer?.destroy();
    }
    this.#bufferReadbackBuffers = [];
    this.#bufferReadbackInUse = [false, false];
    this.#bufferReadbackSize = 0;
    this.#latestResults = [];
  }
}

/***/ },

/***/ "./extensions/VirtualTextures/core/TileLookupFormat.js"
/*!*************************************************************!*\
  !*** ./extensions/VirtualTextures/core/TileLookupFormat.js ***!
  \*************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TILE_FLAG_VALID: () => (/* binding */ TILE_FLAG_VALID),
/* harmony export */   TILE_INVALID: () => (/* binding */ TILE_INVALID),
/* harmony export */   packTileLookup: () => (/* binding */ packTileLookup)
/* harmony export */ });
/**
 * Bit-packing format for a tile page-table value word.
 *
 * The page table (TilePageTable) is a hash of resident tiles; each occupied slot
 * stores a key plus this packed value word, which tells the shader where to find
 * the tile in the cache atlas:
 *
 *   bits  0-7  : cacheX — column of the resident tile in the cache grid (0-255)
 *   bits  8-15 : cacheY — row of the resident tile in the cache grid (0-255)
 *   bit  24    : valid flag (TILE_FLAG_VALID)
 *
 * A value of TILE_INVALID (0) marks an empty slot (a real entry always has the
 * valid bit set, so it is never 0). On a miss the shader walks up to coarser
 * levels to find a resident ancestor, deriving the UV scale/offset from how many
 * levels it climbed.
 *
 * This layout is a contract shared with the GPU side (vtUnpackTileLookup in
 * virtual_texture.wgsl) — keep the two in sync.
 */

/** Tile lookup entry: invalid/empty */
const TILE_INVALID = 0;

/** Flag bit indicating tile is valid/loaded */
const TILE_FLAG_VALID = 1 << 24;

/**
 * Packs a tile lookup entry.
 * @param {number} cacheX - Cache grid X (0-255)
 * @param {number} cacheY - Cache grid Y (0-255)
 * @returns {number} Packed u32
 */
function packTileLookup(cacheX, cacheY) {
  return cacheX & 0xFF |
  (cacheY & 0xFF) << 8 |
  TILE_FLAG_VALID;
}

/***/ },

/***/ "./extensions/VirtualTextures/core/TilePageTable.js"
/*!**********************************************************!*\
  !*** ./extensions/VirtualTextures/core/TilePageTable.js ***!
  \**********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TilePageTable: () => (/* binding */ TilePageTable)
/* harmony export */ });
/* harmony import */ var _TileLookupFormat_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./TileLookupFormat.js */ "./extensions/VirtualTextures/core/TileLookupFormat.js");


/**
 * The virtual→physical page table that the shader samples, backed by an
 * open-addressing hash table that stores only resident tiles (van Waveren,
 * "Software Virtual Textures", SIGGRAPH 2012 — the "hash table" page-table
 * variant).
 *
 * For each resident virtual-texture tile, the table stores the gridCoords in the
 * GPUTileAtlas where to find it. The shader computes the screen-required level,
 * probes for that tile, and — if it isn't resident — walks up to coarser levels
 * (parent = level-1, x>>1, y>>1) until it hits a resident ancestor (guaranteed by
 * the pinned root). This avoids oversampling and makes uploads/evictions O(1)
 * single-slot writes.
 *
 * Why a hash table (vs. one entry per tile per level)? A full mipmap pyramid keeps
 * (4^(L+1)-1)/3 entries, resident-or-not. At leaf level 12 that's ~22M entries
 * (~90 MB); at 20 levels it's ~10^12 entries — too large. But
 * residency is bounded by the atlas's gridSize² slots (pinned tiles occupy those
 * same slots), so almost every pyramid entry would be TILE_INVALID. Storing only
 * resident tiles makes memory O(resident), constant regardless of how many levels
 * the pyramid has.
 *
 * Layout (mirrors the GPU buffer exactly): a flat Uint32Array of `tableSize`
 * slots, 3 u32 each — [keyLo, keyHi, value]:
 *   - keyLo = tileX (<= 26 bits, fits leaf level 26)
 *   - keyHi = (level << 26) | tileY   (level <= 63 in 6 bits, tileY <= 26 bits)
 *   - value = packTileLookup(gridX, gridY) — reuses the shared lookup format;
 *             value === TILE_INVALID (0) marks an EMPTY slot (a real entry always
 *             has the VALID bit set, so it is never 0).
 * The full key is stored so a probe hit can be verified (no false positives).
 *
 * Collisions: open addressing with linear probing. Deletion uses Knuth's
 * backward-shift (algorithm 6.4 R) so the table never accumulates tombstones and
 * a probe chain is always contiguous up to the first empty slot — which lets the
 * GPU shader stop probing at the first empty slot (no tombstone handling).
 *
 * This class owns only the mapping. It does not know about the GPU tile pool,
 * residency policy, or eviction.
 */
class TilePageTable {

  /** @type {number} Number of slots (power of two). */
  #tableSize;

  /** @type {number} tableSize - 1, for cheap modulo on the power-of-two size. */
  #mask;

  /** @type {Uint32Array} Flat slot array: 3 u32 per slot [keyLo, keyHi, value]. */
  #slots;

  /** @type {number} Number of occupied slots. */
  #count = 0;

  /** @type {number} Largest probe distance (slots stepped from a tile's home
   * slot before reaching its actual slot) observed across all resident tiles —
   * i.e. the longest current collision chain. The GPU shader scans a fixed
   * number of slots per lookup, so its probe budget must stay >= this. */
  #maxProbe = 0;

  /** @type {Set<number>} Slot indices whose contents changed since the last flush.
   * Drives incremental GPU upload (flushed at the end of each mutator). */
  #dirty = new Set();

  /** @type {GPUDevice|null} Null for pure-CPU use (unit tests); set for GPU mirroring. */
  #device = null;

  /** @type {GPUBuffer|null} GPU mirror of #slots; the buffer the shader samples (binding 2). */
  #buffer = null;

  /** @type {number} Leaf level (finest mip level). Reported to the cache/shader. */
  #leafLevel;

  /**
   * @param {GPUDevice|null} device - WebGPU device for the GPU buffer mirror.
   *        Pass null for pure-CPU use (unit tests).
   * @param {number} capacity - Expected maximum number of resident tiles
   *        (gridSize²). The table is sized to keep the load factor at/below
   *        `loadFactor` so probe chains stay short.
   * @param {{loadFactor?: number, leafLevel?: number}} [opts]
   */
  constructor(device, capacity, { loadFactor = 0.5, leafLevel = 0 } = {}) {
    const needed = Math.ceil(Math.max(1, capacity) / loadFactor);
    this.#tableSize = TilePageTable.#nextPow2(Math.max(8, needed));
    this.#mask = this.#tableSize - 1;
    this.#slots = new Uint32Array(this.#tableSize * 3); // all TILE_INVALID (0)
    this.#leafLevel = leafLevel;

    this.#device = device || null;
    if (this.#device) {
      // WebGPU zero-initializes buffers, so the initial all-invalid state needs no upload.
      this.#buffer = this.#device.createBuffer({
        label: 'TilePageTable Buffer',
        size: this.#slots.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
      });
    }
  }

  /** @returns {GPUBuffer|null} The GPU page-table buffer (shader binding 2). */
  get buffer() {
    return this.#buffer;
  }

  /** @returns {number} Leaf level (finest mip level). */
  get leafLevel() {
    return this.#leafLevel;
  }

  /** @returns {number} Number of slots in the table (power of two). */
  get tableSize() {
    return this.#tableSize;
  }

  /** @returns {number} Number of occupied slots. */
  get size() {
    return this.#count;
  }

  /** @returns {number} Largest probe distance observed for a resident tile. */
  get maxProbe() {
    return this.#maxProbe;
  }

  /** @returns {Uint32Array} The raw slot array (GPU buffer mirror). */
  get slots() {
    return this.#slots;
  }

  /** Smallest power of two >= n. */
  static #nextPow2(n) {
    let p = 1;
    while (p < n) {
      p <<= 1;
    }
    return p;
  }

  /** Integer spatial hash (Teschner et al.), reduced to a slot index. */
  #home(level, x, y) {
    const h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(level, 83492791)) >>> 0;
    return h & this.#mask;
  }

  /** Encodes (level,x,y) into the two key words stored in a slot. */
  static encodeKey(level, x, y) {
    return {
      lo: x >>> 0,
      hi: ((level & 0x3f) << 26 | y & 0x3ffffff) >>> 0
    };
  }

  /** Decodes the two key words of slot `i` back into (level,x,y). */
  #decodeKeyAt(i) {
    const base = i * 3;
    const lo = this.#slots[base];
    const hi = this.#slots[base + 1];
    return { level: hi >>> 26 & 0x3f, x: lo, y: hi & 0x3ffffff };
  }

  /**
   * Probe for the slot index holding (level,x,y).
   * @returns {number} Slot index, or -1 if not resident.
   */
  #findIndex(level, x, y) {
    // The key is a compact, but still unique identifier - used to verify that a found slot is reallyfor the tile we're looking for.
    const { lo, hi } = TilePageTable.encodeKey(level, x, y);

    // idx is the hash index (for fast search, but not guaranteed to be unique per tile)
    let idx = this.#home(level, x, y);
    for (let p = 0; p < this.#tableSize; p++) {
      const base = idx * 3;

      // It may happen that multiple resident tiles share the same hash index.
      // However, if we have no resident tile at all for this hash, we can already
      // be sure that it's not resident.
      if (this.#slots[base + 2] === _TileLookupFormat_js__WEBPACK_IMPORTED_MODULE_0__.TILE_INVALID) {
        return -1; // empty slot ends the chain (backward-shift keeps it contiguous)
      }

      // If the slot contains the same key as the one we're looking for, we've found the tile.
      if (this.#slots[base] === lo && this.#slots[base + 1] === hi) {
        return idx;
      }

      // Otherwise, we need to continue probing.
      idx = idx + 1 & this.#mask;
    }
    return -1;
  }

  /**
   * Inserts or updates the cache slot for a resident tile. Expected case is usually O(1).
   * @param {{level: number, x: number, y: number}} tileCoord
   * @param {number} gridX - Atlas grid column
   * @param {number} gridY - Atlas grid row
   */
  set(tileCoord, gridX, gridY) {
    const { level, x, y } = tileCoord;
    const { lo, hi } = TilePageTable.encodeKey(level, x, y);
    const value = (0,_TileLookupFormat_js__WEBPACK_IMPORTED_MODULE_0__.packTileLookup)(gridX, gridY); // VALID bit set -> never 0

    let idx = this.#home(level, x, y);
    for (let p = 0; p < this.#tableSize; p++) {
      const base = idx * 3;
      const v = this.#slots[base + 2];
      if (v === _TileLookupFormat_js__WEBPACK_IMPORTED_MODULE_0__.TILE_INVALID) {
        // Slot is empty, we can insert the new tile here.
        this.#slots[base] = lo;
        this.#slots[base + 1] = hi;
        this.#slots[base + 2] = value;

        this.#count++;
        this.#dirty.add(idx);
        if (p > this.#maxProbe) {
          this.#maxProbe = p;
        }

        this.#flushDirty();
        return;
      }

      // If the slot contains the same key as the one we're looking for,
      // this slot was already reserved for the tile earlier.
      if (this.#slots[base] === lo && this.#slots[base + 1] === hi) {
        // Just update the cache grid coords of the tile if they've changed.
        if (this.#slots[base + 2] !== value) {
          this.#slots[base + 2] = value;
          this.#dirty.add(idx);
          this.#flushDirty();
        }
        return;
      }
      idx = idx + 1 & this.#mask;
    }
    throw new Error(`TilePageTable: table full (size ${this.#tableSize}, count ${this.#count})`);
  }

  /**
   * Removes a resident tile, then runs Knuth backward-shift deletion so the
   * probe chain stays contiguous (no tombstones).
   * @param {{level: number, x: number, y: number}} tileCoord
   * @returns {boolean} true if the tile was resident and removed.
   */
  delete(tileCoord) {
    const { level, x, y } = tileCoord;
    let i = this.#findIndex(level, x, y);
    if (i < 0) {
      return false;
    }

    // Backward-shift: keep pulling later entries of the chain into the hole
    // until we reach an empty slot.
    for (;;) {
      const ib = i * 3;
      this.#slots[ib] = 0;
      this.#slots[ib + 1] = 0;
      this.#slots[ib + 2] = _TileLookupFormat_js__WEBPACK_IMPORTED_MODULE_0__.TILE_INVALID;
      this.#dirty.add(i);

      let j = i;
      for (;;) {
        j = j + 1 & this.#mask;
        if (this.#slots[j * 3 + 2] === _TileLookupFormat_js__WEBPACK_IMPORTED_MODULE_0__.TILE_INVALID) {
          this.#count--;
          this.#flushDirty();
          return true;
        }
        const stored = this.#decodeKeyAt(j);
        const k = this.#home(stored.level, stored.x, stored.y);
        // Keep probing while k is cyclically within (i, j]; otherwise the
        // entry at j may be moved into the hole at i.
        const within = i <= j ? i < k && k <= j : i < k || k <= j;
        if (!within) {
          break;
        }
      }

      const jb = j * 3;
      this.#slots[ib] = this.#slots[jb];
      this.#slots[ib + 1] = this.#slots[jb + 1];
      this.#slots[ib + 2] = this.#slots[jb + 2];
      this.#dirty.add(i);
      i = j;
    }
  }

  /**
   * Exact lookup: returns the cache slot for (level,x,y) if that exact tile is
   * resident, else null. Does NOT walk up.
   * @returns {{gridX: number, gridY: number}|null}
   */
  lookup(level, x, y) {
    const i = this.#findIndex(level, x, y);
    if (i < 0) {
      return null;
    }
    const v = this.#slots[i * 3 + 2];
    return { gridX: v & 0xff, gridY: v >> 8 & 0xff };
  }

  /**
   * Resolves a tile by walking up to the closest resident ancestor — the same
   * semantics the shader uses. Starts at (level,x,y); on a miss climbs to
   * (level-1, x>>1, y>>1) and re-probes until a resident tile is found or the
   * root is reached.
   * @returns {{gridX: number, gridY: number, usedLevel: number, tileX: number, tileY: number}|null}
   */
  lookupWithWalkUp(level, x, y) {
    let lv = level;
    let tx = x;
    let ty = y;
    for (;;) {
      const hit = this.lookup(lv, tx, ty);
      if (hit) {
        return { gridX: hit.gridX, gridY: hit.gridY, usedLevel: lv, tileX: tx, tileY: ty };
      }
      if (lv === 0) {
        return null;
      }
      lv--;
      tx >>= 1;
      ty >>= 1;
    }
  }

  /**
   * Records a newly resident tile in the table. O(1).
   * @param {{level: number, x: number, y: number}} tileCoord - Virtual tile coordinates
   * @param {number} gridX - Cache grid X position
   * @param {number} gridY - Cache grid Y position
   */
  updateForTile(tileCoord, gridX, gridY) {
    this.set(tileCoord, gridX, gridY);
  }

  /**
   * Clears a removed tile's entry. Finer-level lookups that relied on it now
   * walk up to the next resident ancestor at sample time. Defensive: only
   * remove if the entry still points to the slot we unloaded (a concurrent
   * reload may already have re-pointed it).
   * @param {{level: number, x: number, y: number}} unloadedTile - The tile that was removed
   * @param {number} unloadedGridX - Cache grid X of the removed tile (defensive check)
   * @param {number} unloadedGridY - Cache grid Y of the removed tile (defensive check)
   */
  clearTileEntry(unloadedTile, unloadedGridX, unloadedGridY) {
    const hit = this.lookup(unloadedTile.level, unloadedTile.x, unloadedTile.y);
    if (!hit) {
      return;
    }
    if (hit.gridX !== unloadedGridX || hit.gridY !== unloadedGridY) {
      return;
    }
    this.delete(unloadedTile);
  }

  /**
   * Clears the page table: all entries set to invalid.
   */
  clear() {
    this.#slots.fill(_TileLookupFormat_js__WEBPACK_IMPORTED_MODULE_0__.TILE_INVALID);
    this.#count = 0;
    this.#maxProbe = 0;
    this.#dirty.clear();
    if (this.#device) {
      this.#device.queue.writeBuffer(this.#buffer, 0, this.#slots);
    }
  }

  /**
   * Uploads all dirty slots to the GPU buffer, then clears the dirty set.
   * Each slot is 3 u32; offset/length are expressed in the #slots typed array.
   */
  #flushDirty() {
    if (this.#device && this.#dirty.size > 0) {
      for (const i of this.#dirty) {
        this.#device.queue.writeBuffer(this.#buffer, i * 12, this.#slots, i * 3, 3);
      }
    }
    this.#dirty.clear();
  }

  /**
   * Releases GPU resources.
   */
  destroy() {
    this.#buffer?.destroy();
    this.#buffer = null;
    this.#device = null;
    this.#slots = null;
  }
}

/***/ },

/***/ "./extensions/VirtualTextures/core/TileTexturePool.js"
/*!************************************************************!*\
  !*** ./extensions/VirtualTextures/core/TileTexturePool.js ***!
  \************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TILE_TEXTURE_USAGE: () => (/* binding */ TILE_TEXTURE_USAGE),
/* harmony export */   TileTexturePool: () => (/* binding */ TileTexturePool),
/* harmony export */   acquireTileTexture: () => (/* binding */ acquireTileTexture)
/* harmony export */ });
/**
 * A recycling pool of per-tile staging textures.
 *
 * Tile sources decode tile content into a short-lived GPUTexture that the cache
 * copies into the atlas and then discards. Allocating/destroying one texture per
 * uploaded tile causes driver churn and memory fragmentation. This pool hands out
 * reusable textures instead: sources `acquire()` one, the cache `release()`s it
 * after the atlas copy, and it goes back on a free list for the next tile.
 *
 * All pooled textures share one descriptor (square `tileSize`, `rgba8unorm`, with
 * the full usage set every source path needs), so any released texture can serve
 * any later request. Textures not created by this pool (e.g. from a source not yet
 * migrated to use it) are simply destroyed on `release()`, matching the old behavior.
 */

// Superset of every source path's needs: TEXTURE_BINDING (sampling not required
// here but harmless), COPY_DST (writeTexture / copyExternalImage), COPY_SRC (copy
// into atlas + border reads), RENDER_ATTACHMENT (required destination usage for
// copyExternalImageToTexture).
const TILE_TEXTURE_USAGE =
GPUTextureUsage.TEXTURE_BINDING |
GPUTextureUsage.COPY_DST |
GPUTextureUsage.COPY_SRC |
GPUTextureUsage.RENDER_ATTACHMENT;

/**
 * Returns a tile-sized rgba8unorm texture for a source to decode into. Fully-covered
 * tiles can be recycled from `pool` (the caller overwrites every texel); partial/edge
 * tiles get a fresh texture so their uncovered region is zero-initialized (a pooled
 * texture would retain a previous tile's pixels there).
 * @param {GPUDevice} device
 * @param {TileTexturePool|null} pool - Recycling pool, or null to always allocate
 * @param {number} tileSize
 * @param {string} label - Debug label used when allocating a fresh texture
 * @param {boolean} fullyCovered - True if the caller overwrites the entire tile
 * @returns {GPUTexture}
 */
function acquireTileTexture(device, pool, tileSize, label, fullyCovered) {
  if (fullyCovered && pool) {
    return pool.acquire();
  }
  return device.createTexture({
    label,
    size: [tileSize, tileSize],
    format: 'rgba8unorm',
    usage: TILE_TEXTURE_USAGE
  });
}

class TileTexturePool {

  /** @type {GPUDevice} */
  #device;

  /** @type {number} */
  #tileSize;

  /** @type {GPUTexture[]} Free list of textures available for reuse. */
  #free = [];

  /** @type {WeakSet<GPUTexture>} Tracks textures this pool created (vs. foreign ones). */
  #owned = new WeakSet();

  /** @type {number} Cap on the free list; textures beyond it are destroyed. */
  #maxFree;

  /**
   * @param {GPUDevice} device
   * @param {number} tileSize - Size of each tile in pixels
   * @param {number} [maxFree=64] - Max textures kept on the free list (~peak concurrency)
   */
  constructor(device, tileSize, maxFree = 64) {
    this.#device = device;
    this.#tileSize = tileSize;
    this.#maxFree = maxFree;
  }

  /**
   * Returns a tile-sized texture, reusing a free one if available.
   * @returns {GPUTexture}
   */
  acquire() {
    const reused = this.#free.pop();
    if (reused) {
      return reused;
    }
    const texture = this.#device.createTexture({
      label: 'TileTexturePool tile',
      size: [this.#tileSize, this.#tileSize],
      format: 'rgba8unorm',
      usage: TILE_TEXTURE_USAGE
    });
    this.#owned.add(texture);
    return texture;
  }

  /**
   * Returns a texture to the pool for reuse. Foreign (non-pool) textures are
   * destroyed instead, preserving the previous create/destroy semantics.
   * @param {GPUTexture} texture
   */
  release(texture) {
    if (!texture) return;
    if (!this.#owned.has(texture) || this.#free.length >= this.#maxFree) {
      texture.destroy();
      return;
    }
    this.#free.push(texture);
  }

  /** Destroys all pooled textures and clears the free list. */
  destroy() {
    for (const texture of this.#free) {
      texture.destroy();
    }
    this.#free = [];
  }
}

/***/ },

/***/ "./extensions/VirtualTextures/core/VirtualTexture.js"
/*!***********************************************************!*\
  !*** ./extensions/VirtualTextures/core/VirtualTexture.js ***!
  \***********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   VirtualTexture: () => (/* binding */ VirtualTexture)
/* harmony export */ });
/* harmony import */ var _src_wgs_wgpu_CustomSampledTexture_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../../src/wgs/wgpu/CustomSampledTexture.js */ "./src/wgs/wgpu/CustomSampledTexture.js");
/* harmony import */ var _src_wgs_wgsl_preprocessor_wgsl_preprocessor_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../../src/wgs/wgsl-preprocessor/wgsl-preprocessor.js */ "./src/wgs/wgsl-preprocessor/wgsl-preprocessor.js");
/* harmony import */ var _virtual_texture_wgsl__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./virtual_texture.wgsl */ "./extensions/VirtualTextures/core/virtual_texture.wgsl");




// Bind group + binding slots for the VT resources, matching the layout the
// cache builds in getBindGroup(). The cache's bind group is bound at group 3
// by UberPipeline.
const VT_BIND_GROUP = 3;
const VT_BINDINGS = {
  vtBindGroup: VT_BIND_GROUP,
  vtParamsBinding: 0,
  vtCacheTextureBinding: 1,
  vtTileLookupBinding: 2,
  vtFeedbackBufferBinding: 4,
  vtCacheSamplerBinding: 101
};


// Main function that is run within fragment shaders.
const sampleCustomTextureFn = `
fn sampleCustomTexture(in: CustomTextureInputs) -> vec4f {
    let vtUv = in.uv;

    let vTexColor = virtualTextureSample(vtUv);
    let newDiffuse = in.prevDiffuse * mix(vec4f(1.0), vTexColor, vTexColor.a);
    let fbSlot = select(0u, 1u, newDiffuse.a < 1.0);
    writeTileFeedback(vtUv, in.fragCoord, fbSlot);
    return newDiffuse;
}
`;

/**
 * A VirtualTexture is a (potentially large) 2D texture that doesn't need to fully exist in memory,
 * but streams tiles on-demand. Simplest variant is the LeafletTileSource - which streams the tiles from
 * a static image pyramid.
 *
 * To do this it implements the WebGPURenderer CustomSampledTexture interface: it supplies a shader chunk
 * (its own sampling code) plus the GPU resources that override the standard 2D texture sampling in WebGPU
 * material shaders, all backed by a VirtualTextureCache.
 *
 * Assign to a material as a shader-driven diffuse map:
 *
 *     material.customSampledTextures = { diffuse: new VirtualTexture(cache) };
 *
 * The shader will:
 *   - Sample the virtual texture cache atlas.
 *   - Modulate the previous diffuse by the sample (alpha-blended).
 *   - Write tile-feedback for the streaming system.
 *
 * Limitations:
 *   - Only meshes with UV (or UVW) coords are supported. The framework gates
 *     this via UberPipeline.#usesCustomTexture, so getShaderChunk() is only
 *     invoked for geometry that has UVs.
 *
 * The cache's bind group is bound at group 3 by UberPipeline.
 */
class VirtualTexture extends _src_wgs_wgpu_CustomSampledTexture_js__WEBPACK_IMPORTED_MODULE_0__.CustomSampledTexture {

  /**
   * @param {import('./VirtualTextureCache').VirtualTextureCache} cache
   */
  constructor(cache) {
    super();
    this.cache = cache;
  }

  getShaderChunk() {
    // The framework only calls this when the custom texture applies
    // (UberPipeline.#usesCustomTexture already requires UV coords + lit
    // triangles), and the contract is to always return a non-empty chunk.
    return (0,_src_wgs_wgsl_preprocessor_wgsl_preprocessor_js__WEBPACK_IMPORTED_MODULE_1__.$wgsl)(_virtual_texture_wgsl__WEBPACK_IMPORTED_MODULE_2__, VT_BINDINGS) + sampleCustomTextureFn;
  }

  getBindGroupLayout() {
    // Cache lazily creates layout inside getBindGroup() — call it first.
    this.cache.getBindGroup();
    return this.cache.getBindGroupLayout();
  }

  getBindGroup() {
    return this.cache.getBindGroup();
  }
}

/***/ },

/***/ "./extensions/VirtualTextures/core/VirtualTextureBindGroup.js"
/*!********************************************************************!*\
  !*** ./extensions/VirtualTextures/core/VirtualTextureBindGroup.js ***!
  \********************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   VirtualTextureBindGroup: () => (/* binding */ VirtualTextureBindGroup)
/* harmony export */ });
/* harmony import */ var _TileFeedbackProcessor_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./TileFeedbackProcessor.js */ "./extensions/VirtualTextures/core/TileFeedbackProcessor.js");


/**
 * Assembles and owns the GPU bind group the virtual-texture shader samples
 * (group 3 in the uber shader), plus all the buffers that back it.
 *
 * Bindings:
 * - 0: VirtualTextureParams uniform (dims + viewport + flags)
 * - 1: cache atlas texture (from the tile pool)
 * - 2: tile lookup storage buffer (from the page table)
 * - 4: feedback storage buffer (atomic<u32>, 2 slots per grid cell,
 *      FEEDBACK_WORDS_PER_SLOT words each)
 * - 101: cache sampler
 *
 * Pure GPU resource plumbing: it reads the atlas texture and page-table buffer
 * from the pool/page-table it is given, and owns the params/sampler/feedback
 * buffers. It holds no residency state.
 */
class VirtualTextureBindGroup {

  /** @type {GPUDevice} */
  #device;

  /** @type {import('./GPUTileAtlas.js').GPUTileAtlas} */
  #tileAtlas;

  /** @type {import('./TilePageTable.js').TilePageTable} */
  #pageTable;

  // Immutable shader params
  #virtualWidth;
  #virtualHeight;
  #gridSize;
  #tileSize;
  #borderSize;
  #anisotropy;
  #feedbackGridSize;

  // Hash page-table dimensions the shader needs to probe binding 2:
  // #pageTableSize = slot count (power of two; mask = size-1),
  // #pageTableProbe = fixed probe budget (an exhausted probe walks up a level).
  #pageTableSize;
  #pageTableProbe;

  // Region: the leaf-pixel rectangle this material's uv [0,1] maps onto.
  // Default (origin 0, size = full texture) reproduces the legacy whole-texture
  // mapping. See virtual_texture.wgsl (VirtualTextureParams.regionPx*).
  #regionPxX;
  #regionPxY;
  #regionPxW;
  #regionPxH;

  // Mutable shader params (re-uploaded on change)
  #discardTransparent = false;
  #viewportWidth = 1;
  #viewportHeight = 1;

  /** @type {GPUBuffer|null} */
  #shaderParamsBuffer = null;

  /** @type {GPUSampler|null} */
  #shaderSampler = null;

  /** @type {GPUBindGroup|null} */
  #shaderBindGroup = null;

  /** @type {GPUBindGroupLayout|null} */
  #shaderBindGroupLayout = null;

  /** @type {GPUBuffer|null} Feedback storage buffer (atomic<u32>, 2 slots per cell) */
  #feedbackBuffer = null;

  /**
   * @param {GPUDevice} device
   * @param {Object} config
   * @param {import('./GPUTileAtlas.js').GPUTileAtlas} config.tileAtlas - Source of the atlas texture
   * @param {import('./TilePageTable.js').TilePageTable} config.pageTable - Source of the lookup buffer
   * @param {number} config.virtualWidth
   * @param {number} config.virtualHeight
   * @param {number} config.gridSize
   * @param {number} config.tileSize
   * @param {number} config.borderSize
   * @param {number} [config.anisotropy=1] - Max anisotropic-filtering ratio for the sampler.
   * @param {number} [config.feedbackGridSize=128]
   * @param {number} config.pageTableSize - Hash page-table slot count (power of two).
   * @param {number} config.pageTableProbe - Fixed probe budget the shader uses.
   * @param {number} [config.regionPxX=0] - Region origin X in leaf pixels.
   * @param {number} [config.regionPxY=0] - Region origin Y in leaf pixels (top-down).
   * @param {number} [config.regionPxW] - Region width in leaf pixels; defaults to the full texture (virtualWidth*tileSize).
   * @param {number} [config.regionPxH] - Region height in leaf pixels; defaults to the full texture (virtualHeight*tileSize).
   */
  constructor(device, { tileAtlas, pageTable, virtualWidth, virtualHeight, gridSize, tileSize, borderSize, anisotropy = 1, feedbackGridSize = 128, pageTableSize, pageTableProbe, regionPxX = 0, regionPxY = 0, regionPxW, regionPxH }) {
    this.#device = device;
    this.#tileAtlas = tileAtlas;
    this.#pageTable = pageTable;
    this.#virtualWidth = virtualWidth;
    this.#virtualHeight = virtualHeight;
    this.#gridSize = gridSize;
    this.#tileSize = tileSize;
    this.#borderSize = borderSize;
    this.#anisotropy = Math.max(1, Math.round(anisotropy));
    this.#feedbackGridSize = feedbackGridSize;
    this.#pageTableSize = pageTableSize;
    this.#pageTableProbe = pageTableProbe;
    this.#regionPxX = regionPxX;
    this.#regionPxY = regionPxY;
    // Default region = whole texture, so the shader math is a no-op vs. legacy.
    this.#regionPxW = regionPxW ?? virtualWidth * tileSize;
    this.#regionPxH = regionPxH ?? virtualHeight * tileSize;
  }

  /** @returns {number} Feedback grid dimension */
  get feedbackGridSize() {
    return this.#feedbackGridSize;
  }

  /**
   * Returns the feedback storage buffer (for readback). Null until getBindGroup() runs.
   * @returns {GPUBuffer|null}
   */
  getFeedbackBuffer() {
    return this.#feedbackBuffer;
  }

  /**
   * Clears the feedback buffer to zero before a new frame.
   * @param {GPUCommandEncoder} commandEncoder
   */
  clearFeedbackBuffer(commandEncoder) {
    if (this.#feedbackBuffer) {
      commandEncoder.clearBuffer(this.#feedbackBuffer);
    }
  }

  /**
   * Sets the viewport size for feedback grid mapping.
   * Call this on resize and before each frame that uses feedback.
   * @param {number} width
   * @param {number} height
   */
  setViewportSize(width, height) {
    if (this.#viewportWidth === width && this.#viewportHeight === height) return;
    this.#viewportWidth = width;
    this.#viewportHeight = height;
    this.#uploadShaderParams();
  }

  /**
   * When true, transparent fragments are discarded during rendering.
   * Used during tile feedback capture to see tiles behind glass.
   * @returns {boolean}
   */
  get discardTransparent() {
    return this.#discardTransparent;
  }

  /** @param {boolean} value */
  set discardTransparent(value) {
    if (this.#discardTransparent === value) return;
    this.#discardTransparent = value;
    this.#uploadShaderParams();
  }

  /**
   * Gets the VT bind group for use in any shader (e.g., as group 3 in uber shader).
   * Creates resources lazily on first call.
   * @returns {GPUBindGroup}
   */
  getBindGroup() {
    if (this.#shaderBindGroup) {
      return this.#shaderBindGroup;
    }

    // Create params uniform buffer
    // 16 x i32 = 64 bytes (already 16-byte aligned, no padding needed)
    this.#shaderParamsBuffer = this.#device.createBuffer({
      label: 'VT Params',
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    this.#uploadShaderParams();

    // Create sampler. Only the anisotropy>1 case adds mipmapFilter/maxAnisotropy,
    // so the default (anisotropy==1) sampler is byte-identical to the original
    // trilinear path. WebGPU requires mipmapFilter:'linear' (and linear min/mag)
    // when maxAnisotropy > 1; the atlas is single-mip so mipmapFilter is a no-op
    // and the aniso filter just takes multiple bilinear taps in mip 0.
    const samplerDesc = {
      label: 'VT Sampler',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear'
    };
    if (this.#anisotropy > 1) {
      samplerDesc.mipmapFilter = 'linear';
      samplerDesc.maxAnisotropy = this.#anisotropy;
    }
    this.#shaderSampler = this.#device.createSampler(samplerDesc);

    // Build bind group layout entries
    const layoutEntries = [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
    { binding: 101, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }];


    // Build bind group entries
    const bindGroupEntries = [
    { binding: 0, resource: { buffer: this.#shaderParamsBuffer } },
    { binding: 1, resource: this.#tileAtlas.texture.createView() },
    { binding: 2, resource: { buffer: this.#pageTable.buffer } },
    { binding: 101, resource: this.#shaderSampler }];


    // Create feedback storage buffer: 2 slots per grid cell (opaque +
    // transparent), FEEDBACK_WORDS_PER_SLOT atomic<u32> each ([key, xFull, yFull]).
    const feedbackBufferSize = this.#feedbackGridSize * this.#feedbackGridSize * 2 * _TileFeedbackProcessor_js__WEBPACK_IMPORTED_MODULE_0__.FEEDBACK_WORDS_PER_SLOT * 4;
    this.#feedbackBuffer = this.#device.createBuffer({
      label: 'VT Feedback Buffer',
      size: feedbackBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    });
    layoutEntries.push({
      binding: 4,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: { type: 'storage' }
    });
    bindGroupEntries.push({
      binding: 4,
      resource: { buffer: this.#feedbackBuffer }
    });

    // Create bind group layout
    this.#shaderBindGroupLayout = this.#device.createBindGroupLayout({
      label: 'VT BindGroupLayout',
      entries: layoutEntries
    });

    // Create bind group
    this.#shaderBindGroup = this.#device.createBindGroup({
      label: 'VT BindGroup',
      layout: this.#shaderBindGroupLayout,
      entries: bindGroupEntries
    });

    return this.#shaderBindGroup;
  }

  /**
   * Gets the VT bind group layout.
   * Must call getBindGroup() first to initialize.
   * @returns {GPUBindGroupLayout|null}
   */
  getBindGroupLayout() {
    return this.#shaderBindGroupLayout;
  }

  /**
   * Invalidates the shader bind group (call when the backing resources change).
   */
  invalidateBindGroup() {
    this.#shaderBindGroup = null;
    // Keep the layout - it doesn't change
  }

  /**
   * Re-uploads the VT params uniform buffer.
   */
  #uploadShaderParams() {
    if (!this.#shaderParamsBuffer) return;
    this.#device.queue.writeBuffer(
      this.#shaderParamsBuffer, 0,
      new Int32Array([
      this.#virtualWidth, this.#virtualHeight, this.#gridSize,
      this.#tileSize, this.#borderSize, this.#discardTransparent ? 1 : 0,
      this.#feedbackGridSize, this.#viewportWidth, this.#viewportHeight,
      this.#anisotropy,
      this.#pageTableSize, this.#pageTableProbe,
      this.#regionPxX, this.#regionPxY,
      this.#regionPxW, this.#regionPxH]
      )
    );
  }

  /**
   * Releases owned GPU resources.
   */
  destroy() {
    this.#shaderParamsBuffer?.destroy();
    this.#shaderParamsBuffer = null;
    this.#feedbackBuffer?.destroy();
    this.#feedbackBuffer = null;
    this.#shaderBindGroup = null;
    this.#shaderBindGroupLayout = null;
    this.#shaderSampler = null;
  }
}

/***/ },

/***/ "./extensions/VirtualTextures/core/VirtualTextureCache.js"
/*!****************************************************************!*\
  !*** ./extensions/VirtualTextures/core/VirtualTextureCache.js ***!
  \****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TILE_UPLOADED_EVENT: () => (/* binding */ TILE_UPLOADED_EVENT),
/* harmony export */   VirtualTextureCache: () => (/* binding */ VirtualTextureCache)
/* harmony export */ });
/* harmony import */ var _src_wgs_scene_leaflet_TileCoords_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../../src/wgs/scene/leaflet/TileCoords.js */ "./src/wgs/scene/leaflet/TileCoords.js");
/* harmony import */ var _GPUTileAtlas_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./GPUTileAtlas.js */ "./extensions/VirtualTextures/core/GPUTileAtlas.js");
/* harmony import */ var _TilePageTable_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./TilePageTable.js */ "./extensions/VirtualTextures/core/TilePageTable.js");
/* harmony import */ var _TileTexturePool_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./TileTexturePool.js */ "./extensions/VirtualTextures/core/TileTexturePool.js");
/* harmony import */ var _VirtualTextureBindGroup_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./VirtualTextureBindGroup.js */ "./extensions/VirtualTextures/core/VirtualTextureBindGroup.js");






/**
 * @typedef {Object} ITileSource
 * @property {function(TileCoords): Promise<GPUTexture>} loadTile - Loads tile content as a GPUTexture
 * @property {number} tileSize - Size of tiles in pixels
 * @property {number} [maxLevel] - Maximum level index (0-based). If set, cache won't request beyond this.
 * @property {function(TileCoords): boolean} [isValidTile] - Returns true if tile exists. If set, cache won't request invalid tiles.
 * @property {function(TileTexturePool): void} [setTileTexturePool] - If set, cache injects a recycling pool the source acquires tile textures from.
 */

/** Event fired when a tile is uploaded to the cache */
const TILE_UPLOADED_EVENT = 'tileUploaded';

/**
 * Coordinates virtual-texture tile streaming.
 *
 * High-level entry point that wires together three collaborators:
 * - {@link GPUTileAtlas}: device-side storage of resident tiles (+ borders).
 * - {@link TilePageTable}: the resident-tile→cache mapping the shader samples.
 * - this class: residency policy (LRU/priority eviction), tile loading, and
 *   the shader bind group.
 *
 * Supports event listeners via addEventListener/removeEventListener.
 * Events: 'tileUploaded' - { gridX, gridY, tileCoord }
 */
class VirtualTextureCache {

  /** @type {GPUDevice} */
  #device;

  /** @type {number} */
  #tileSize;

  /** @type {number} the cache is a square grid of #gridSize x #gridSize tiles */
  #gridSize;

  /** @type {number} */
  #virtualWidth;

  /** @type {number} */
  #virtualHeight;

  /** @type {GPUTileAtlas} The atlas of resident tile slots on GPU (device-side storage + borders). */
  #tileAtlas;

  /** @type {TilePageTable} The virtual→physical mapping the shader samples (binding 2). */
  #pageTable;

  /** @type {ITileSource|null} */
  #tileSource = null;

  /** @type {TileTexturePool} Recycles per-tile staging textures returned by the source. */
  #tileTexturePool;

  /** @type {Map<string, TileCoords>} Maps "gridX,gridY" -> TileCoords for tracking what's in each cache cell */
  #cacheContents = new Map();

  /** @type {Map<string, number>} Maps "gridX,gridY" -> priority (feedback count) */
  #slotPriority = new Map();

  /** @type {Set<string>} Tile keys currently being loaded */
  #pendingLoads = new Set();

  /** @type {Set<string>} Cache slots reserved for pending loads ("gridX,gridY") */
  #reservedSlots = new Set();

  /** @type {number} Number of coarse levels that are pinned (never evicted) */
  #pinnedLevelCount = 2;

  /** @type {Map<string, {gridX: number, gridY: number}>} Tile key -> cache slot for fast lookup */
  #tileToSlot = new Map();

  /** @type {number} Max anisotropic-filtering ratio (1 = isotropic/trilinear). */
  #anisotropy = 1;

  /** @type {number} Border size in pixels around each tile. Derived from #anisotropy. */
  #borderSize = 1;

  /** @type {number|null} Debug-only max level (null = no limit). Set via setLevelLimit(). */
  #levelLimit = null;

  /** @type {number} Feedback buffer grid dimension (e.g., 128 = 128x128 cells, 2 slots each) */
  #feedbackGridSize = 128;

  /** @type {VirtualTextureBindGroup} The shader bind group + its backing buffers (params, sampler, uv, feedback). */
  #bindGroup;

  /** @type {boolean} Set in destroy(); guards async loadTile continuations against use-after-destroy. */
  #destroyed = false;

  /** @type {number} Bumped by clearAllTiles()/destroy(); in-flight loads with a stale value drop their result. */
  #generation = 0;

  /**
   * @param {GPUDevice} device
   * @param {number} tileSize - Size of each tile in pixels (e.g., 256)
   * @param {number} gridSize - Number of tiles per row/column in cache (e.g., 32 for 8192px atlas)
   * @param {number} virtualWidth - Virtual texture width in tiles
   * @param {number} virtualHeight - Virtual texture height in tiles
   * @param {number} [pinnedLevelCount=2] - Number of coarse levels to pin (never evict)
   * @param {number} [anisotropy=1] - Max anisotropic-filtering ratio. Border width is
   *        derived from this (borderSize = ceil(anisotropy/2)) so the elongated aniso
   *        footprint stays inside the padded tile region.
   * @param {{x:number,y:number,w:number,h:number}} [region] - Optional sub-rectangle of
   *        virtual (leaf-level) pixel space that uv [0,1] maps onto. Omitted ⇒ whole texture.
   */
  constructor(device, tileSize = 256, gridSize = 32, virtualWidth = 64, virtualHeight = 64, pinnedLevelCount = 2, anisotropy = 1, region = null) {
    this.#device = device;

    // Note this cap is NOT the feedback key: tile feedback stores full 32-bit
    // tile coords alongside its 13-bit-coord key (see virtual_texture.wgsl
    // writeTileFeedback / TileFeedbackProcessor), so feedback does not limit
    // the level count. The cap comes from a different key — the hash
    // page-table key in TilePageTable.encodeKey — which packs (level, tileY)
    // into one u32 as (level << 26) | tileY, giving tile Y 26 bits (tile X is
    // a full u32 but capped to match). So a tile coordinate must stay < 2^26:
    // leaf level 26 (67108864 tiles == 17179869184 px per axis).
    const maxTilesPerAxis = 1 << 26;
    if (virtualWidth > maxTilesPerAxis || virtualHeight > maxTilesPerAxis) {
      throw new Error(`VirtualTextureCache: virtual size ${virtualWidth}x${virtualHeight} tiles exceeds the ${maxTilesPerAxis}-tile (leaf level 26) limit of the hash page-table key`);
    }

    this.#virtualWidth = virtualWidth;
    this.#virtualHeight = virtualHeight;
    this.#pinnedLevelCount = pinnedLevelCount;

    // The aniso footprint can reach anisotropy/2 texels past a tile edge, so the
    // border must be at least that wide to avoid sampling a neighbor's payload.
    this.#anisotropy = Math.max(1, Math.min(16, Math.round(anisotropy)));
    this.#borderSize = Math.max(1, Math.ceil(this.#anisotropy / 2));

    // The GPU tile atlas owns the device-side texture + border maintenance.
    // It may clamp gridSize to fit the texture size limit, so read back the actual values.
    this.#tileAtlas = new _GPUTileAtlas_js__WEBPACK_IMPORTED_MODULE_1__.GPUTileAtlas(device, tileSize, gridSize, this.#borderSize);
    this.#tileSize = this.#tileAtlas.tileSize;
    this.#gridSize = this.#tileAtlas.gridSize;

    // Recycles the short-lived per-tile textures the source decodes into, so we
    // don't create+destroy a GPUTexture for every uploaded tile.
    this.#tileTexturePool = new _TileTexturePool_js__WEBPACK_IMPORTED_MODULE_3__.TileTexturePool(device, this.#tileSize);

    // The page table maps each resident virtual tile (level,x,y) -> cache
    // position via an open-addressing hash (the shader probes it). Memory is
    // bounded by the atlas (at most one resident tile per slot), so it scales
    // to deep pyramids. Load factor <= 0.5 keeps probe chains short (measured
    // max ~5 at this load); the shader's fixed probe budget must cover that.
    const leafLevel = Math.log2(Math.max(virtualWidth, virtualHeight));
    const capacity = this.#gridSize * this.#gridSize;
    this.#pageTable = new _TilePageTable_js__WEBPACK_IMPORTED_MODULE_2__.TilePageTable(device, capacity, { loadFactor: 0.5, leafLevel });
    const pageTableSize = this.#pageTable.tableSize;
    const pageTableProbe = 32; // generous bound; an exhausted probe just walks up a level

    // Assembles the shader bind group (group 3) and owns its backing buffers
    // (params/sampler/uv/feedback). Reads the atlas + lookup buffer lazily.
    this.#bindGroup = new _VirtualTextureBindGroup_js__WEBPACK_IMPORTED_MODULE_4__.VirtualTextureBindGroup(device, {
      tileAtlas: this.#tileAtlas,
      pageTable: this.#pageTable,
      virtualWidth,
      virtualHeight,
      gridSize: this.#gridSize,
      tileSize: this.#tileSize,
      borderSize: this.#borderSize,
      anisotropy: this.#anisotropy,
      feedbackGridSize: this.#feedbackGridSize,
      pageTableSize,
      pageTableProbe,
      // Optional region (leaf-pixel sub-rectangle uv [0,1] maps onto);
      // omitted fields fall back to the full-texture default in the bind group.
      regionPxX: region?.x,
      regionPxY: region?.y,
      regionPxW: region?.w,
      regionPxH: region?.h
    });

    // Mix in EventDispatcher
    Autodesk.Viewing.EventDispatcher.prototype.apply(this);
  }

  /**
   * Copies a tile texture into the cache at the specified grid position and updates tracking.
   * The GPU texture/border work is delegated to the tile atlas; this method owns the
   * residency tracking (#cacheContents/#tileToSlot) and page-table update.
   * @param {GPUTexture} tileTexture - Source tile texture (must match tileSize)
   * @param {number} gridX - Grid column (0 to gridSize-1)
   * @param {number} gridY - Grid row (0 to gridSize-1)
   * @param {TileCoords} [tileCoord] - Optional virtual tile coords to update lookup
   */
  uploadTile(tileTexture, gridX, gridY, tileCoord) {
    if (this.#destroyed) {
      return;
    }
    // Resolver lets the atlas find already-cached virtual neighbors for border copies.
    const resolveNeighborSlot = (level, x, y) => this.#tileToSlot.get(`${level},${x},${y}`) || null;
    const written = this.#tileAtlas.writeTile(gridX, gridY, tileTexture, tileCoord, resolveNeighborSlot);
    if (!written) {
      return;
    }

    // Track what's in this cache cell
    const cacheKey = `${gridX},${gridY}`;
    if (tileCoord) {
      this.#cacheContents.set(cacheKey, tileCoord);
      // Also track reverse mapping for fast lookup
      const tileKey = `${tileCoord.level},${tileCoord.x},${tileCoord.y}`;
      this.#tileToSlot.set(tileKey, { gridX, gridY });
      this.#pageTable.updateForTile(tileCoord, gridX, gridY);
    }

    this.dispatchEvent({ type: TILE_UPLOADED_EVENT, gridX, gridY, tileCoord });
  }

  /**
   * @returns {number} Tile size in pixels
   */
  get tileSize() {
    return this.#tileSize;
  }

  /**
   * @returns {number} The GPUTileAtlas holds a squared grid of #gridSize x #gridSize tiles.
   */
  get gridSize() {
    return this.#gridSize;
  }

  /** @returns {number} Max anisotropic-filtering ratio (1 = isotropic/trilinear). */
  get anisotropy() {
    return this.#anisotropy;
  }

  /** @returns {number} Border width in pixels around each tile (derived from anisotropy). */
  get borderSize() {
    return this.#borderSize;
  }

  /**
   * Sets the tile source used for loading tile content.
   * @param {ITileSource} tileSource
   */
  setTileSource(tileSource) {
    if (tileSource.tileSize !== this.#tileSize) {
      console.warn(`VirtualTextureCache: tileSource.tileSize (${tileSource.tileSize}) !== cache tileSize (${this.#tileSize})`);
    }
    this.#tileSource = tileSource;

    // Share the recycling texture pool so the source can acquire reusable tile
    // textures instead of allocating a fresh one per tile.
    if (typeof tileSource.setTileTexturePool === 'function') {
      tileSource.setTileTexturePool(this.#tileTexturePool);
    }

    // Register invalidation callback if source supports it
    if (typeof tileSource.setOnTileInvalidated === 'function') {
      tileSource.setOnTileInvalidated((tileCoord) => this.#onTileInvalidated(tileCoord));
    }
  }

  /**
   * Called when a tile source indicates a tile has been invalidated.
   * Reloads the tile if currently resident in cache.
   * @param {{level: number, x: number, y: number}} tileCoord
   */
  async #onTileInvalidated(tileCoord) {
    const tileKey = `${tileCoord.level},${tileCoord.x},${tileCoord.y}`;
    const slot = this.#tileToSlot.get(tileKey);

    if (slot) {
      await this.loadTile(tileCoord, slot.gridX, slot.gridY);
    }
  }

  /**
   * Loads a tile from the tile source and uploads it to the cache.
   * Updates the tileLookup buffer to map the virtual tile to its cache position.
   * @param {TileCoords} tileCoord - The tile coordinates to load
   * @param {number} gridX - Grid column to place the tile
   * @param {number} gridY - Grid row to place the tile
   * @returns {Promise<void>}
   */
  async loadTile(tileCoord, gridX, gridY) {
    if (!this.#tileSource) {
      console.error('VirtualTextureCache: No tile source set');
      return;
    }

    const tileKey = `${tileCoord.level},${tileCoord.x},${tileCoord.y}`;
    const slotKey = `${gridX},${gridY}`;
    const generation = this.#generation;

    // Reserve the slot for the whole async load. Done synchronously (before
    // the first await) so a same-frame #findSlotForTile already sees the slot
    // as taken — it can neither be double-picked nor evicted while we load.
    // Marking #pendingLoads also stops requestTiles starting a duplicate load.
    this.#pendingLoads.add(tileKey);
    this.#reservedSlots.add(slotKey);

    let texture;
    try {
      texture = await this.#tileSource.loadTile(tileCoord);
    } catch (err) {
      this.#releaseLoad(tileKey, slotKey, generation);
      throw err;
    }

    // The cache may have been destroyed or cleared (clearAllTiles) while the
    // source was loading. Both already dropped our reservation and bumped
    // #generation — and the slot may now be reserved by a fresh load — so we
    // must NOT touch the bookkeeping here (see #releaseLoad). Just drop the
    // payload. After destroy() the pool is gone, so release() is null-safe.
    if (this.#destroyed || generation !== this.#generation) {
      this.#tileTexturePool?.release(texture);
      return;
    }

    // Since we reserved (gridX, gridY) before starting to load, in-flight
    // loads cannot be evicted, because the eviction doesn't touch reserved
    // slots - only used ones.
    //
    // However, this tile's parent may have been evicted. Uploading now would
    // orphan the tile in the page table. It would become a child with no resident
    // parent — breaking the hierarchical invariant and leaving a
    // tile #findSlotForTile can no longer evict.
    // For this case, we drop the result; a later frame re-requests it once the
    // parent is resident again. For now, if not even the parent is needed anymore,
    // dropping the tile shouldn't be a problem anyway.
    const parentEvicted = !this.#isPinnedLevel(tileCoord.level) &&
    !this.#isParentCached(tileCoord.level, tileCoord.x, tileCoord.y);

    // parentEvicted is usually false, unless in race-condition edge cases.
    if (!parentEvicted) {
      this.uploadTile(texture, gridX, gridY, tileCoord);
    }

    // Return the staging texture to the pool for reuse. uploadTile() already
    // queued the atlas copy, so reuse can't clobber it (WebGPU queue ordering).
    // Textures the pool doesn't own are destroyed by release().
    this.#tileTexturePool.release(texture);

    this.#releaseLoad(tileKey, slotKey, generation);
  }

  /**
   * Clears the in-flight bookkeeping (#pendingLoads/#reservedSlots) for a load,
   * but only if the load still owns it. If #generation has moved on
   * (clearAllTiles/destroy) the reservation was already dropped and the slot may
   * have been handed to a newer load, so a stale continuation must leave it alone.
   * @param {string} tileKey
   * @param {string} slotKey
   * @param {number} generation - The #generation captured when the load started.
   */
  #releaseLoad(tileKey, slotKey, generation) {
    if (generation !== this.#generation) {
      return;
    }
    this.#pendingLoads.delete(tileKey);
    this.#reservedSlots.delete(slotKey);
  }

  /**
   * Unloads a tile from a cache cell.
   * Lookup entries that pointed to this tile will fall back to the best available parent tile.
   * @param {number} gridX - Grid column (0 to gridSize-1)
   * @param {number} gridY - Grid row (0 to gridSize-1)
   * @returns {TileCoords|null} The tile that was unloaded, or null if cell was empty
   */
  unloadTile(gridX, gridY) {
    if (gridX < 0 || gridX >= this.#gridSize || gridY < 0 || gridY >= this.#gridSize) {
      console.warn(`VirtualTextureCache: grid position (${gridX}, ${gridY}) out of bounds`);
      return null;
    }

    const cacheKey = `${gridX},${gridY}`;
    const tileCoord = this.#cacheContents.get(cacheKey);

    if (!tileCoord) {
      return null;
    }

    // Remove from tracking first (so it's not considered as a fallback for itself)
    this.#cacheContents.delete(cacheKey);
    this.#slotPriority.delete(cacheKey);
    const tileKey = `${tileCoord.level},${tileCoord.x},${tileCoord.y}`;
    this.#tileToSlot.delete(tileKey);

    // Clear this tile's page-table entry; finer lookups walk up to a resident ancestor.
    this.#pageTable.clearTileEntry(tileCoord, gridX, gridY);

    this.dispatchEvent({ type: TILE_UPLOADED_EVENT, gridX, gridY, tileCoord: null });

    return tileCoord;
  }

  /**
   * Evicts a tile and all its descendants from the cache.
   * This maintains the hierarchical invariant: children can't exist without parents.
   * @param {TileCoords} rootTile - The root of the subtree to evict
   */
  #evictSubtree(rootTile) {
    // Collect all tiles that are descendants of rootTile
    const toEvict = [];

    for (const [cacheKey, tileCoord] of this.#cacheContents) {
      if (this.#isDescendantOf(tileCoord, rootTile)) {
        const [gridX, gridY] = cacheKey.split(',').map(Number);
        toEvict.push({ gridX, gridY, tileCoord });
      }
    }

    // Evict in reverse level order (deepest first) to maintain invariant during eviction
    toEvict.sort((a, b) => b.tileCoord.level - a.tileCoord.level);

    for (const { gridX, gridY } of toEvict) {
      this.unloadTile(gridX, gridY);
    }
  }

  /**
   * Check if a tile is a descendant of (or equal to) another tile.
   * @param {TileCoords} tile
   * @param {TileCoords} ancestor
   * @returns {boolean}
   */
  #isDescendantOf(tile, ancestor) {
    if (tile.level < ancestor.level) return false;

    // Scale tile coords to ancestor's level
    const levelDiff = tile.level - ancestor.level;
    const ancestorX = tile.x >> levelDiff;
    const ancestorY = tile.y >> levelDiff;

    return ancestorX === ancestor.x && ancestorY === ancestor.y;
  }

  /**
   * Get parent tile coordinates.
   * @param {number} level
   * @param {number} x
   * @param {number} y
   * @returns {{level: number, x: number, y: number}|null} Parent coords, or null if at root
   */
  #getParentCoords(level, x, y) {
    if (level <= 0) return null;
    return {
      level: level - 1,
      x: x >> 1,
      y: y >> 1
    };
  }

  /**
   * Check if the parent of a tile is cached.
   * @param {number} level
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  #isParentCached(level, x, y) {
    const parent = this.#getParentCoords(level, x, y);
    if (!parent) return true; // Root has no parent, always "covered"
    const parentKey = `${parent.level},${parent.x},${parent.y}`;
    return this.#tileToSlot.has(parentKey);
  }

  /**
   * Check if a tile is at a pinned level (cannot be evicted).
   * @param {number} level
   * @returns {boolean}
   */
  #isPinnedLevel(level) {
    return level < this.#pinnedLevelCount;
  }

  /**
   * @returns {number} Virtual texture width in tiles
   */
  get virtualWidth() {
    return this.#virtualWidth;
  }

  /**
   * @returns {number} Virtual texture height in tiles
   */
  get virtualHeight() {
    return this.#virtualHeight;
  }

  /**
   * @returns {number} Leaf level (finest mip level)
   */
  get leafLevel() {
    return this.#pageTable.leafLevel;
  }

  // ========================================================================
  // Tile Request / Eviction API
  // ========================================================================

  /**
   * Call once per frame. Resets priorities so only current-frame feedback counts.
   */
  tick() {
    // Reset all priorities — only tiles in current feedback will get non-zero priority
    for (const key of this.#slotPriority.keys()) {
      this.#slotPriority.set(key, 0);
    }
  }

  /**
   * Request tiles based on feedback sampler output.
   * Loads tiles in priority order, evicting low-priority tiles as needed.
   * Automatically requests parent tiles when needed to maintain hierarchical invariant.
   * @param {Array<{level: number, tileX: number, tileY: number, count: number}>} requests
   * @param {number} [maxLoadsPerFrame=4] - Max tiles to start loading this frame
   * @param {boolean} [verbose=false] - Log detailed info about each request
   * @returns {number} Number of tiles queued for loading
   */
  requestTiles(requests, maxLoadsPerFrame = 4, verbose = false) {
    let queued = 0;
    let skippedLoaded = 0;
    let skippedPending = 0;

    // Filter requests to respect the effective max level (tile source's declared
    // max, optionally further capped by the debug-only #levelLimit).
    const sourceMaxLevel = this.#tileSource?.maxLevel;
    const effectiveMaxLevel = this.#levelLimit !== null ?
    sourceMaxLevel !== undefined ? Math.min(sourceMaxLevel, this.#levelLimit) : this.#levelLimit :
    sourceMaxLevel;
    const clampedRequests = effectiveMaxLevel !== undefined ?
    requests.filter((r) => r.level <= effectiveMaxLevel) :
    requests;

    // Build a set of all requested tiles + their required parents
    const expandedRequests = this.#expandWithParents(clampedRequests);

    // Sort by level (coarse first) to ensure parents load before children
    expandedRequests.sort((a, b) => a.level - b.level);

    for (const req of expandedRequests) {
      if (queued >= maxLoadsPerFrame) break;

      const tileKey = `${req.level},${req.tileX},${req.tileY}`;

      // Skip if tile source says tile doesn't exist
      if (this.#tileSource?.isValidTile) {
        const tileCoord = { level: req.level, x: req.tileX, y: req.tileY };
        if (!this.#tileSource.isValidTile(tileCoord)) {
          continue;
        }
      }

      // Skip if already loaded
      if (this.#isTileLoaded(req.level, req.tileX, req.tileY)) {
        // Touch the slot to mark as recently used and update priority
        this.#touchTile(req.level, req.tileX, req.tileY, req.count);
        skippedLoaded++;
        continue;
      }

      // Skip if already loading
      if (this.#pendingLoads.has(tileKey)) {
        skippedPending++;
        continue;
      }

      // Hierarchical rule: can only load if parent is cached (or at pinned level)
      if (!this.#isPinnedLevel(req.level) && !this.#isParentCached(req.level, req.tileX, req.tileY)) {
        // Parent not cached yet — will be handled in a future frame
        continue;
      }

      // Find a slot (empty or evict if new tile has higher priority)
      const slot = this.#findSlotForTile(req.level, req.count);
      if (!slot) {
        // No slot available OR new tile isn't valuable enough to evict anything
        if (verbose) {
          console.log(`Skipping tile ${tileKey} (priority ${req.count}): no slot or lower priority than cached`);
        }
        continue;
      }

      // Seed the slot's residency priority from this frame's feedback. The
      // in-flight bookkeeping (#pendingLoads/#reservedSlots) is owned by
      // loadTile. A lingering priority entry on a failed/skipped load is
      // harmless: it's read only for resident (in #cacheContents) slots and
      // tick() resets it each frame.
      const slotKey = `${slot.gridX},${slot.gridY}`;
      this.#slotPriority.set(slotKey, req.count);
      const tileCoord = new _src_wgs_scene_leaflet_TileCoords_js__WEBPACK_IMPORTED_MODULE_0__.TileCoords(req.level, req.tileX, req.tileY);

      if (verbose) {
        console.log(`Loading tile ${tileKey} (priority ${req.count}) → slot (${slot.gridX}, ${slot.gridY})`);
      }

      this.loadTile(tileCoord, slot.gridX, slot.gridY).catch((err) => {
        console.error('VirtualTextureCache: Failed to load tile', tileKey, err);
      });

      queued++;
    }

    if (verbose) {
      console.log(`requestTiles: ${queued} queued, ${skippedLoaded} already loaded, ${skippedPending} pending`);
    }

    return queued;
  }

  /**
   * Expand tile requests to include all required parent tiles.
   * Parents inherit the max priority of their children.
   * @param {Array<{level: number, tileX: number, tileY: number, count: number}>} requests
   * @returns {Array<{level: number, tileX: number, tileY: number, count: number}>}
   */
  #expandWithParents(requests) {
    const tileMap = new Map(); // key -> {level, tileX, tileY, count}

    for (const req of requests) {
      // Add the requested tile
      let level = req.level;
      let x = req.tileX;
      let y = req.tileY;
      let priority = req.count;

      // Walk up the hierarchy to pinned levels
      while (level >= this.#pinnedLevelCount) {
        const key = `${level},${x},${y}`;
        const existing = tileMap.get(key);
        if (existing) {
          // Keep max priority
          existing.count = Math.max(existing.count, priority);
        } else {
          tileMap.set(key, { level, tileX: x, tileY: y, count: priority });
        }

        // Move to parent
        level--;
        x = x >> 1;
        y = y >> 1;
      }
    }

    return Array.from(tileMap.values());
  }

  /**
   * Check if a tile is already loaded in the cache.
   * @param {number} level
   * @param {number} tileX
   * @param {number} tileY
   * @returns {boolean}
   */
  #isTileLoaded(level, tileX, tileY) {
    return this.#tileToSlot.has(`${level},${tileX},${tileY}`);
  }

  /**
   * Touch a tile to mark it as recently used and update its priority.
   * @param {number} level
   * @param {number} tileX
   * @param {number} tileY
   * @param {number} priority - New priority (feedback count)
   */
  #touchTile(level, tileX, tileY, priority) {
    const slot = this.#tileToSlot.get(`${level},${tileX},${tileY}`);
    if (slot) {
      // Set priority from current feedback (reset each frame in tick())
      this.#slotPriority.set(`${slot.gridX},${slot.gridY}`, priority);
    }
  }

  /**
   * Find a cache slot for a new tile.
   * Prefers empty slots, then evicts lowest-priority tile IF new tile has higher priority.
   * @param {number} tileLevel - Level of tile to load (used for eviction priority)
   * @param {number} incomingPriority - Priority of the new tile (feedback count)
   * @returns {{gridX: number, gridY: number}|null}
   */
  #findSlotForTile(tileLevel, incomingPriority) {
    // First, look for empty slots (not occupied and not reserved)
    for (let y = 0; y < this.#gridSize; y++) {
      for (let x = 0; x < this.#gridSize; x++) {
        const key = `${x},${y}`;
        if (!this.#cacheContents.has(key) && !this.#reservedSlots.has(key)) {
          return { gridX: x, gridY: y };
        }
      }
    }

    // All slots full — find lowest-priority cached tile that CAN be evicted
    // Eviction rules:
    // 1. Never evict pinned levels (root + coarse levels)
    // 2. Never evict reserved slots (loading in progress)
    // 3. Only evict if parent is cached (hierarchical coverage guarantee)
    let bestSlot = null;
    let lowestPriority = Infinity;

    for (const [cacheKey, tileCoord] of this.#cacheContents) {
      const [gridX, gridY] = cacheKey.split(',').map(Number);

      // Rule 1: Never evict pinned levels
      if (this.#isPinnedLevel(tileCoord.level)) {
        continue;
      }

      // Rule 2: Never evict reserved slots (loading in progress)
      if (this.#reservedSlots.has(cacheKey)) {
        continue;
      }

      // Rule 3: Only evict if parent is cached (ensures fallback exists)
      if (!this.#isParentCached(tileCoord.level, tileCoord.x, tileCoord.y)) {
        continue;
      }

      const priority = this.#slotPriority.get(cacheKey) || 0;

      if (priority < lowestPriority) {
        lowestPriority = priority;
        bestSlot = { gridX, gridY, cacheKey, priority, tileCoord };
      }
    }

    // Only evict if incoming tile has HIGHER priority (with small margin to prevent oscillation)
    const PRIORITY_MARGIN = 2; // Require at least this much priority advantage
    if (bestSlot && incomingPriority > lowestPriority + PRIORITY_MARGIN) {
      // Evict the tile AND all its descendants (to maintain hierarchical invariant)
      this.#evictSubtree(bestSlot.tileCoord);
      return { gridX: bestSlot.gridX, gridY: bestSlot.gridY };
    }

    // New tile isn't valuable enough to evict anything — cache is optimal
    return null;
  }

  /**
   * Get cache statistics.
   * @returns {{used: number, total: number, pending: number}}
   */
  getStats() {
    return {
      used: this.#cacheContents.size,
      total: this.#gridSize * this.#gridSize,
      pending: this.#pendingLoads.size
    };
  }

  /**
   * Hash page-table occupancy/probe stats. Useful to verify the table stays
   * well below its probe budget. Exposed for console inspection via window.vtCache.
   * @returns {{tableSize: number, size: number, maxProbe: number}}
   */
  getPageTableStats() {
    return {
      tableSize: this.#pageTable.tableSize,
      size: this.#pageTable.size,
      maxProbe: this.#pageTable.maxProbe
    };
  }

  // ========================================================================
  // Debug API (no programmatic callers; exposed via window.vtCache in examples
  // for console inspection — keep separate from the production path above).
  // ========================================================================

  /**
   * Returns info about what's currently resident in the cache.
   * @returns {Array<{gridX: number, gridY: number, tileCoord: TileCoords}>}
   */
  getCacheContents() {
    const result = [];
    for (const [key, tileCoord] of this.#cacheContents) {
      const [gridX, gridY] = key.split(',').map(Number);
      result.push({ gridX, gridY, tileCoord });
    }
    return result;
  }

  /**
   * Gets the tile coordinates stored at a given cache grid position.
   * @param {number} gridX - Cache grid X (0 to gridSize-1)
   * @param {number} gridY - Cache grid Y (0 to gridSize-1)
   * @returns {TileCoords|null} The tile at this position, or null if empty
   */
  getTileAt(gridX, gridY) {
    return this.#cacheContents.get(`${gridX},${gridY}`) || null;
  }

  /**
   * Finds which cache grid position contains a given tile.
   * @param {number} level - Tile level
   * @param {number} tileX - Tile X coordinate
   * @param {number} tileY - Tile Y coordinate
   * @returns {{gridX: number, gridY: number}|null} Cache position, or null if not cached
   */
  findTileInCache(level, tileX, tileY) {
    return this.#tileToSlot.get(`${level},${tileX},${tileY}`) || null;
  }

  /**
   * Clears all resident tiles without destroying the cache. Lookup entries are
   * invalidated; on the next refine pass tiles reload from the source. Useful
   * for testing whether seams come from cache state vs. tile content.
   */
  clearAllTiles() {
    // Invalidate in-flight loads so their continuations don't re-populate the cleared state.
    this.#generation++;
    this.#pageTable.clear();
    this.#cacheContents.clear();
    this.#slotPriority.clear();
    this.#pendingLoads.clear();
    this.#reservedSlots.clear();
    this.#tileToSlot.clear();
  }

  /**
   * Sets a maximum level limit (debug). Evicts tiles finer than `level` and
   * prevents loading any finer tile until the limit is cleared.
   * @param {number|null} level - Maximum allowed level, or null to remove the limit
   */
  setLevelLimit(level) {
    this.#levelLimit = level;
    if (level === null) {
      return;
    }

    const toEvict = [];
    for (const [cacheKey, tileCoord] of this.#cacheContents) {
      if (tileCoord.level > level) {
        const [gridX, gridY] = cacheKey.split(',').map(Number);
        toEvict.push({ gridX, gridY, tileCoord });
      }
    }
    // Evict deepest first to maintain the hierarchical invariant.
    toEvict.sort((a, b) => b.tileCoord.level - a.tileCoord.level);
    for (const { gridX, gridY } of toEvict) {
      this.unloadTile(gridX, gridY);
    }
  }

  /**
   * @returns {number|null} The current level limit, or null if no limit
   */
  getLevelLimit() {
    return this.#levelLimit;
  }

  /**
   * When true, transparent fragments are discarded during rendering.
   * Used during tile feedback capture to see tiles behind glass.
   * @returns {boolean}
   */
  get discardTransparent() {
    return this.#bindGroup.discardTransparent;
  }

  /**
   * @param {boolean} value
   */
  set discardTransparent(value) {
    this.#bindGroup.discardTransparent = value;
  }

  /**
   * Load all pinned levels (root + coarse tiles) into the cache.
   * These tiles are permanently resident and never evicted.
   * Call this after setting the tile source.
   * @returns {Promise<void>}
   */
  async loadPinnedLevels() {
    if (!this.#tileSource) {
      console.error('VirtualTextureCache.loadPinnedLevels: No tile source set');
      return;
    }

    const promises = [];
    let slotIndex = 0;
    const slotCount = this.#gridSize * this.#gridSize;

    outer:
    for (let level = 0; level < this.#pinnedLevelCount; level++) {
      const tilesAtLevel = 1 << level; // 1, 2, 4, ... tiles per axis
      for (let y = 0; y < tilesAtLevel; y++) {
        for (let x = 0; x < tilesAtLevel; x++) {
          if (slotIndex >= slotCount) {
            console.error('VirtualTextureCache.loadPinnedLevels: Not enough cache slots for pinned levels');
            break outer;
          }

          const gridX = slotIndex % this.#gridSize;
          const gridY = Math.floor(slotIndex / this.#gridSize);

          const tileCoord = new _src_wgs_scene_leaflet_TileCoords_js__WEBPACK_IMPORTED_MODULE_0__.TileCoords(level, x, y);
          promises.push(this.loadTile(tileCoord, gridX, gridY));
          slotIndex++;
        }
      }
    }

    await Promise.all(promises);

  }

  /**
   * Get the number of pinned levels.
   * @returns {number}
   */
  get pinnedLevelCount() {
    return this.#pinnedLevelCount;
  }

  // ========================================================================
  // Feedback Buffer
  // ========================================================================

  /**
   * Sets the viewport size for feedback grid mapping.
   * Call this on resize and before each frame that uses feedback.
   * @param {number} width
   * @param {number} height
   */
  setViewportSize(width, height) {
    this.#bindGroup.setViewportSize(width, height);
  }

  /** @returns {number} Feedback grid dimension */
  get feedbackGridSize() {return this.#bindGroup.feedbackGridSize;}

  /**
   * Returns the feedback storage buffer (for readback).
   * @returns {GPUBuffer|null}
   */
  getFeedbackBuffer() {return this.#bindGroup.getFeedbackBuffer();}

  /**
   * Clears the feedback buffer to zero before a new frame.
   * @param {GPUCommandEncoder} commandEncoder
   */
  clearFeedbackBuffer(commandEncoder) {
    this.#bindGroup.clearFeedbackBuffer(commandEncoder);
  }

  // ========================================================================
  // Shader Bind Group (delegated to VirtualTextureBindGroup)
  // ========================================================================

  /**
   * Gets the VT bind group for use in any shader (e.g., as group 3 in uber shader).
   * @returns {GPUBindGroup}
   */
  getBindGroup() {
    return this.#bindGroup.getBindGroup();
  }

  /**
   * Gets the VT bind group layout.
   * Must call getBindGroup() first to initialize.
   * @returns {GPUBindGroupLayout|null}
   */
  getBindGroupLayout() {
    return this.#bindGroup.getBindGroupLayout();
  }

  /**
   * Invalidates the shader bind group (call when cache texture changes).
   */
  invalidateBindGroup() {
    this.#bindGroup.invalidateBindGroup();
  }

  /**
   * Destroys the cache and releases GPU resources.
   */
  destroy() {
    // Guard async loadTile continuations that may still be awaiting the source.
    this.#destroyed = true;
    this.#generation++;
    this.#tileSource = null;
    this.#tileTexturePool?.destroy();
    this.#tileTexturePool = null;
    this.#tileAtlas?.destroy();
    this.#tileAtlas = null;
    this.#pageTable?.destroy();
    this.#pageTable = null;
    this.#cacheContents.clear();
    this.#slotPriority.clear();
    this.#pendingLoads.clear();
    this.#reservedSlots.clear();
    this.#tileToSlot.clear();
    this.#bindGroup?.destroy();
  }
}

/***/ },

/***/ "./extensions/VirtualTextures/tilesources/LeafletTileSource.js"
/*!*********************************************************************!*\
  !*** ./extensions/VirtualTextures/tilesources/LeafletTileSource.js ***!
  \*********************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   LeafletTileSource: () => (/* binding */ LeafletTileSource)
/* harmony export */ });
/* harmony import */ var _TileLoaderWorkerPool_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./TileLoaderWorkerPool.js */ "./extensions/VirtualTextures/tilesources/TileLoaderWorkerPool.js");
/* harmony import */ var _OPFSTileCache_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./OPFSTileCache.js */ "./extensions/VirtualTextures/tilesources/OPFSTileCache.js");
/* harmony import */ var _core_TileTexturePool_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../core/TileTexturePool.js */ "./extensions/VirtualTextures/core/TileTexturePool.js");




/**
 * Tile source that loads tiles from a Leaflet-style image pyramid.
 * Implements ITileSource interface for VirtualTextureCache.
 */
class LeafletTileSource {

  /** @type {GPUDevice} */
  #device;

  /** @type {string} */
  #baseUrl;

  /** @type {number} */
  #tileSize;

  /** @type {number} */
  #maxLevel;

  /** @type {number} */
  #width;

  /** @type {number} */
  #height;

  /** @type {string} */
  #urlTemplate;

  /** @type {TileLoaderWorkerPool} */
  #workerPool;

  /** @type {OPFSTileCache|null} */
  #cache = null;

  /** @type {Promise<void>|null} */
  #cacheInitPromise = null;

  /** @type {import('../core/TileTexturePool.js').TileTexturePool|null} Recycles tile textures (injected by the cache). */
  #tileTexturePool = null;

  /**
   * @param {Object} config
   * @param {GPUDevice} config.device - WebGPU device
   * @param {string} config.baseUrl - Base URL for tile images
   * @param {number} [config.tileSize=256] - Tile size in pixels
   * @param {number} config.maxLevel - Maximum level index (0-based)
   * @param {number} config.width - Full texture width in pixels
   * @param {number} config.height - Full texture height in pixels
   * @param {string} [config.urlTemplate='{baseUrl}/{level}/tile_{level}_{x}_{y}.jpg'] - URL template
   * @param {string} [config.cacheBucket] - OPFS bucket path for caching (optional)
   * @param {'raw' | 'png' | 'jpeg'} [config.cacheFormat='jpeg'] - Cache storage format
   */
  constructor({ device, baseUrl, tileSize = 256, maxLevel, width, height, urlTemplate, cacheBucket, cacheFormat = 'jpeg' }) {
    this.#device = device;
    this.#baseUrl = baseUrl.replace(/\/+$/, ''); // Remove trailing slashes
    this.#tileSize = tileSize;
    this.#maxLevel = maxLevel;
    this.#width = width;
    this.#height = height;
    this.#urlTemplate = urlTemplate ?? '{baseUrl}/{level}/{y}/tile_{level}_{x}_{y}.jpg';

    // Create worker pool for non-blocking tile loading
    this.#workerPool = new _TileLoaderWorkerPool_js__WEBPACK_IMPORTED_MODULE_0__.TileLoaderWorkerPool({
      workerCount: 4
    });

    // Initialize optional OPFS cache
    if (cacheBucket) {
      this.#cache = new _OPFSTileCache_js__WEBPACK_IMPORTED_MODULE_1__.OPFSTileCache({
        device,
        bucketPath: cacheBucket,
        tileSize,
        format: cacheFormat
      });
      this.#cacheInitPromise = this.#cache.init();
    }
  }

  /**
   * Injects the cache's recycling texture pool. When set, decoded tiles are
   * written into pooled textures instead of freshly allocated ones.
   * @param {import('../core/TileTexturePool.js').TileTexturePool} pool
   */
  setTileTexturePool(pool) {
    this.#tileTexturePool = pool;
    // Share it with the OPFS cache so cached-tile loads recycle too.
    this.#cache?.setTileTexturePool(pool);
  }

  /**
   * Returns a tile-sized texture (Leaflet tiles always cover the full tile, so
   * a recycled pool texture is safe).
   * @param {string} label
   * @returns {GPUTexture}
   */
  #acquireTileTexture(label) {
    return (0,_core_TileTexturePool_js__WEBPACK_IMPORTED_MODULE_2__.acquireTileTexture)(this.#device, this.#tileTexturePool, this.#tileSize, label, true);
  }

  /**
   * Checks if a tile coordinate is valid (within bounds).
   * @param {TileCoords} tileCoord
   * @returns {boolean}
   */
  isValidTile(tileCoord) {
    const { level, x, y } = tileCoord;

    // Check level bounds
    if (level < 0 || level > this.#maxLevel) {
      return false;
    }

    // Calculate tile count at this level
    const scale = Math.pow(2, this.#maxLevel - level);
    const levelWidth = Math.ceil(this.#width / scale);
    const levelHeight = Math.ceil(this.#height / scale);
    const tilesX = Math.ceil(levelWidth / this.#tileSize);
    const tilesY = Math.ceil(levelHeight / this.#tileSize);

    // Check x/y bounds
    if (x < 0 || x >= tilesX || y < 0 || y >= tilesY) {
      return false;
    }

    return true;
  }

  /**
   * Builds the URL for a given tile coordinate.
   * @param {TileCoords} tileCoord
   * @returns {string}
   */
  buildUrl(tileCoord) {
    return this.#urlTemplate.
    replace(/{baseUrl}/g, this.#baseUrl).
    replace(/{level}/g, String(tileCoord.level)).
    replace(/{x}/g, String(tileCoord.x)).
    replace(/{y}/g, String(tileCoord.y));
  }

  /**
   * Returns a fallback texture for load errors (magenta).
   * Creates the texture lazily on first use.
   * @returns {GPUTexture}
   */
  #getFallbackTexture() {
    // A fresh/recycled texture is returned on every call (never a shared
    // singleton): VirtualTextureCache.loadTile() releases the returned texture
    // to the pool after uploading it, so a singleton would be use-after-free.
    const size = this.#tileSize;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      data[i * 4 + 0] = 255; // R
      data[i * 4 + 1] = 0; // G
      data[i * 4 + 2] = 255; // B
      data[i * 4 + 3] = 255; // A
    }

    const texture = this.#acquireTileTexture('LeafletTile_fallback');

    this.#device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: size * 4 },
      [size, size]
    );

    return texture;
  }

  /**
   * Returns a transparent texture for out-of-bounds tiles.
   * Creates the texture lazily on first use.
   * @returns {GPUTexture}
   */
  #getTransparentTexture() {
    // A fresh/recycled texture is returned on every call (never a shared
    // singleton): VirtualTextureCache.loadTile() releases the returned texture
    // to the pool after uploading it, so a singleton would be use-after-free.
    const size = this.#tileSize;
    // All zeros = transparent black
    const data = new Uint8Array(size * size * 4);

    const texture = this.#acquireTileTexture('LeafletTile_transparent');

    this.#device.queue.writeTexture(
      { texture },
      data,
      { bytesPerRow: size * 4 },
      [size, size]
    );

    return texture;
  }

  /**
   * Loads a tile from the image pyramid.
   * Returns transparent texture for out-of-bounds, magenta for load errors.
   * @param {TileCoords} tileCoord
   * @returns {Promise<GPUTexture>}
   */
  async loadTile(tileCoord) {
    // Out-of-bounds tiles get transparent (expected case, no error)
    if (!this.isValidTile(tileCoord)) {
      return this.#getTransparentTexture();
    }

    // Try cache first (if enabled)
    if (this.#cache) {
      await this.#cacheInitPromise;
      const cached = await this.#cache.loadTile(tileCoord);
      if (cached) {
        return cached;
      }
    }

    const url = this.buildUrl(tileCoord);

    // Fetch and decode image in worker (non-blocking)
    let bitmap;
    try {
      bitmap = await this.#workerPool.loadImage(url, tileCoord);
    } catch (error) {
      // TODO: As soon as we start using Leaflet TileSources in production scenarios,
      //       we should consider a smarter graceful handling of failing tile requests.
      console.error(`LeafletTileSource: Failed to load tile: ${url} (${error.message})`);
      return this.#getFallbackTexture();
    }

    // Acquire GPU texture (main thread); reused from the pool when available.
    const texture = this.#acquireTileTexture(`LeafletTile_${tileCoord.level}_${tileCoord.x}_${tileCoord.y}`);

    this.#device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture },
      [this.#tileSize, this.#tileSize]
    );

    bitmap.close(); // Release ImageBitmap memory

    // Save to cache (fire-and-forget, don't block return)
    if (this.#cache) {
      this.#cache.saveTileFromTexture(tileCoord, texture).catch((err) => {
        console.warn(`LeafletTileSource: Failed to cache tile: ${err.message}`);
      });
    }

    return texture;
  }

  /** @returns {number} */
  get tileSize() {
    return this.#tileSize;
  }

  /** @returns {number} */
  get maxLevel() {
    return this.#maxLevel;
  }

  /** @returns {number} */
  get width() {
    return this.#width;
  }

  /** @returns {number} */
  get height() {
    return this.#height;
  }

  /**
   * Clean up resources.
   */
  destroy() {
    this.#workerPool.destroy();
    // Note: OPFSTileCache has no destroy() - OPFS handles are auto-released
  }
}

/***/ },

/***/ "./extensions/VirtualTextures/tilesources/OPFSTileCache.js"
/*!*****************************************************************!*\
  !*** ./extensions/VirtualTextures/tilesources/OPFSTileCache.js ***!
  \*****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   OPFSTileCache: () => (/* binding */ OPFSTileCache)
/* harmony export */ });
/* harmony import */ var _core_TileTexturePool_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../core/TileTexturePool.js */ "./extensions/VirtualTextures/core/TileTexturePool.js");


/**
 * Tile cache that stores/retrieves texture tiles from OPFS (Origin Private File System).
 * Can be used as a caching layer in front of other tile sources.
 *
 * All caches are stored under a common root folder ('vt-cache').
 */
class OPFSTileCache {

  /** Root folder for all OPFSTileCache data in OPFS */
  static ROOT_FOLDER = 'vt-cache';

  /** @type {GPUDevice} */
  #device;

  /** @type {string} */
  #bucketPath;

  /** @type {number} */
  #tileSize;

  /** @type {'raw' | 'png' | 'jpeg'} */
  #format;

  /** @type {FileSystemDirectoryHandle|null} */
  #rootHandle = null;

  /** @type {boolean} */
  #initialized = false;

  /** @type {import('../core/TileTexturePool.js').TileTexturePool|null} Recycles tile textures (injected by the owning source). */
  #tileTexturePool = null;

  /**
   * @param {Object} config
   * @param {GPUDevice} config.device - WebGPU device
   * @param {string} config.bucketPath - OPFS folder path for this cache (e.g., 'tile-cache/my-dataset')
   * @param {number} [config.tileSize=256] - Tile size in pixels
   * @param {'raw' | 'png' | 'jpeg'} [config.format='raw'] - Storage format
   */
  constructor({ device, bucketPath, tileSize = 256, format = 'raw' }) {
    this.#device = device;
    this.#bucketPath = bucketPath;
    this.#tileSize = tileSize;
    this.#format = format;
  }

  /**
   * Injects a recycling texture pool. When set, loadTile() returns pooled
   * textures instead of freshly allocated ones. Cached tiles always cover the
   * full tile, so pooled textures are always safe here.
   * @param {import('../core/TileTexturePool.js').TileTexturePool} pool
   */
  setTileTexturePool(pool) {
    this.#tileTexturePool = pool;
  }

  /**
   * Initializes OPFS access. Must be called before load/save operations.
   * @returns {Promise<void>}
   */
  async init() {
    if (this.#initialized) return;

    const opfsRoot = await navigator.storage.getDirectory();

    // Start from the common root folder
    let current = await opfsRoot.getDirectoryHandle(OPFSTileCache.ROOT_FOLDER, { create: true });

    // Navigate/create the bucket path hierarchy
    const parts = this.#bucketPath.split('/').filter((p) => p.length > 0);
    for (const part of parts) {
      // Secure-dev rule (sanitize external input used in file/dir access):
      // reject path traversal and unexpected characters before handing the
      // segment to OPFS, since some implementations let '..' escape the bucket.
      if (part === '.' || part === '..' || !/^[A-Za-z0-9_.-]+$/.test(part)) {
        throw new Error(`OPFSTileCache: invalid bucketPath segment "${part}"`);
      }
      current = await current.getDirectoryHandle(part, { create: true });
    }

    this.#rootHandle = current;
    this.#initialized = true;
  }

  /**
   * Builds the file path for a tile: {level}/{x}/{y}.{ext}
   * @param {TileCoords} tileCoord
   * @returns {{dirPath: string[], fileName: string}}
   */
  #getTilePath(tileCoord) {
    const ext = this.#format === 'raw' ? 'bin' : this.#format;
    return {
      dirPath: [String(tileCoord.level), String(tileCoord.x)],
      fileName: `${tileCoord.y}.${ext}`
    };
  }

  /**
   * Saves a tile to OPFS from a GPUTexture.
   * @param {TileCoords} tileCoord
   * @param {GPUTexture} texture - Must have COPY_SRC usage
   * @returns {Promise<void>}
   */
  async saveTileFromTexture(tileCoord, texture) {
    if (!this.#initialized) {
      throw new Error('OPFSTileCache: call init() before save/load operations');
    }

    // Calculate buffer size with row alignment (256 bytes for WebGPU)
    const bytesPerRow = Math.ceil(this.#tileSize * 4 / 256) * 256;
    const bufferSize = bytesPerRow * this.#tileSize;

    // Create staging buffer for readback
    const stagingBuffer = this.#device.createBuffer({
      label: 'OPFSTileCache_staging',
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });

    // Copy texture to staging buffer
    const encoder = this.#device.createCommandEncoder({ label: 'OPFSTileCache_readback' });
    encoder.copyTextureToBuffer(
      { texture },
      { buffer: stagingBuffer, bytesPerRow },
      [this.#tileSize, this.#tileSize]
    );
    this.#device.queue.submit([encoder.finish()]);

    // Map and read pixel data
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const mappedData = new Uint8Array(stagingBuffer.getMappedRange());

    // Remove row padding if present
    let pixelData;
    if (bytesPerRow === this.#tileSize * 4) {
      pixelData = new Uint8Array(mappedData);
    } else {
      // Copy row by row, removing padding
      pixelData = new Uint8Array(this.#tileSize * this.#tileSize * 4);
      const rowBytes = this.#tileSize * 4;
      for (let y = 0; y < this.#tileSize; y++) {
        pixelData.set(
          mappedData.subarray(y * bytesPerRow, y * bytesPerRow + rowBytes),
          y * rowBytes
        );
      }
    }

    stagingBuffer.unmap();
    stagingBuffer.destroy();

    // Save using the pixel method
    await this.saveTileFromPixels(tileCoord, pixelData);
  }

  /**
   * Gets or creates a nested directory handle.
   * @param {string[]} pathParts
   * @returns {Promise<FileSystemDirectoryHandle>}
   */
  async #getOrCreateDir(pathParts) {
    let current = this.#rootHandle;
    for (const part of pathParts) {
      current = await current.getDirectoryHandle(part, { create: true });
    }
    return current;
  }

  /**
   * Encodes pixel data to the configured format.
   * @param {Uint8Array} pixelData - RGBA pixel data
   * @returns {Promise<Uint8Array>}
   */
  async #encodePixels(pixelData) {
    if (this.#format === 'raw') {
      return pixelData;
    }

    // Use canvas to encode PNG/JPEG
    const canvas = new OffscreenCanvas(this.#tileSize, this.#tileSize);
    const ctx = canvas.getContext('2d');
    const imageData = new ImageData(
      new Uint8ClampedArray(pixelData.buffer, pixelData.byteOffset, pixelData.byteLength),
      this.#tileSize,
      this.#tileSize
    );
    ctx.putImageData(imageData, 0, 0);

    const mimeType = this.#format === 'png' ? 'image/png' : 'image/jpeg';
    const quality = this.#format === 'jpeg' ? 0.9 : undefined;
    const blob = await canvas.convertToBlob({ type: mimeType, quality });
    return new Uint8Array(await blob.arrayBuffer());
  }

  /**
   * Saves a tile to OPFS from raw pixel data.
   * @param {TileCoords} tileCoord
   * @param {Uint8Array} pixelData - RGBA pixel data (tileSize * tileSize * 4 bytes)
   * @returns {Promise<void>}
   */
  async saveTileFromPixels(tileCoord, pixelData) {
    if (!this.#initialized) {
      throw new Error('OPFSTileCache: call init() before save/load operations');
    }

    const { dirPath, fileName } = this.#getTilePath(tileCoord);
    const dirHandle = await this.#getOrCreateDir(dirPath);
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });

    const encoded = await this.#encodePixels(pixelData);
    const writable = await fileHandle.createWritable();
    await writable.write(encoded);
    await writable.close();
  }

  /**
   * Tries to get a directory handle without creating it.
   * @param {string[]} pathParts
   * @returns {Promise<FileSystemDirectoryHandle|null>}
   */
  async #tryGetDir(pathParts) {
    let current = this.#rootHandle;
    for (const part of pathParts) {
      try {
        current = await current.getDirectoryHandle(part, { create: false });
      } catch {
        return null;
      }
    }
    return current;
  }

  /**
   * Decodes file data to pixel array.
   * @param {Uint8Array} data
   * @returns {Promise<Uint8Array>}
   */
  async #decodeToPixels(data) {
    if (this.#format === 'raw') {
      return data;
    }

    // Decode PNG/JPEG using createImageBitmap
    const blob = new Blob([data], {
      type: this.#format === 'png' ? 'image/png' : 'image/jpeg'
    });
    const bitmap = await createImageBitmap(blob);

    // Extract pixels via canvas
    const canvas = new OffscreenCanvas(this.#tileSize, this.#tileSize);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const imageData = ctx.getImageData(0, 0, this.#tileSize, this.#tileSize);
    return new Uint8Array(imageData.data.buffer);
  }

  /**
   * Loads a tile from OPFS.
   * @param {TileCoords} tileCoord
   * @returns {Promise<GPUTexture|null>} - null if tile doesn't exist
   */
  async loadTile(tileCoord) {
    if (!this.#initialized) {
      throw new Error('OPFSTileCache: call init() before save/load operations');
    }

    const { dirPath, fileName } = this.#getTilePath(tileCoord);

    // Try to get directory
    const dirHandle = await this.#tryGetDir(dirPath);
    if (!dirHandle) {
      return null;
    }

    // Try to get file
    let fileHandle;
    try {
      fileHandle = await dirHandle.getFileHandle(fileName, { create: false });
    } catch {
      return null;
    }

    // Read and decode
    const file = await fileHandle.getFile();
    const arrayBuffer = await file.arrayBuffer();
    const pixelData = await this.#decodeToPixels(new Uint8Array(arrayBuffer));

    // Acquire GPU texture (recycled from the pool when available). Cached tiles
    // always fill the whole tile, so a recycled texture is fully overwritten.
    const texture = (0,_core_TileTexturePool_js__WEBPACK_IMPORTED_MODULE_0__.acquireTileTexture)(
      this.#device, this.#tileTexturePool, this.#tileSize,
      `OPFSTile_${tileCoord.level}_${tileCoord.x}_${tileCoord.y}`, true);

    this.#device.queue.writeTexture(
      { texture },
      pixelData,
      { bytesPerRow: this.#tileSize * 4 },
      [this.#tileSize, this.#tileSize]
    );

    return texture;
  }

  /** @returns {number} */
  get tileSize() {
    return this.#tileSize;
  }

  /** @returns {string} */
  get bucketPath() {
    return this.#bucketPath;
  }

  /** @returns {'raw' | 'png' | 'jpeg'} */
  get format() {
    return this.#format;
  }

}

/***/ },

/***/ "./extensions/VirtualTextures/tilesources/TileLoaderWorkerPool.js"
/*!************************************************************************!*\
  !*** ./extensions/VirtualTextures/tilesources/TileLoaderWorkerPool.js ***!
  \************************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TileLoaderWorkerPool: () => (/* binding */ TileLoaderWorkerPool)
/* harmony export */ });
// Inline worker code as string to avoid bundler/path issues
const WORKER_CODE = `
self.addEventListener('message', async (event) => {
    const { id, url, tileCoord } = event.data;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            self.postMessage({ id, error: \`HTTP \${response.status}\`, tileCoord });
            return;
        }

        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        // Send back bitmap (transferred, not copied)
        self.postMessage({ id, bitmap, tileCoord }, [bitmap]);
    } catch (error) {
        self.postMessage({ id, error: error.message, tileCoord });
    }
});
`;

/**
 * Pool of Web Workers for parallel tile loading and decoding.
 * Prevents image decode from blocking the main thread and rendering.
 */
class TileLoaderWorkerPool {

  /** @type {Worker[]} */
  #workers = [];

  /** @type {number} */
  #nextWorkerIndex = 0;

  /** @type {number} */
  #nextRequestId = 0;

  /** @type {Map<number, {resolve: Function, reject: Function}>} */
  #pendingRequests = new Map();

  /** @type {string} */
  #workerBlobUrl;

  /**
   * @param {Object} config
   * @param {number} [config.workerCount=4] - Number of workers in the pool
   */
  constructor({ workerCount = 4 } = {}) {
    // Create blob URL from inline worker code
    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    this.#workerBlobUrl = URL.createObjectURL(blob);

    // Create worker pool
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(this.#workerBlobUrl, { name: `TileLoader-${i}` });
      worker.addEventListener('message', (event) => this.#handleWorkerMessage(event));
      worker.addEventListener('error', (event) => this.#handleWorkerError(event));
      this.#workers.push(worker);
    }
  }

  /**
   * Load and decode an image in a worker thread.
   * @param {string} url - URL of the image to load
   * @param {Object} tileCoord - Tile coordinates (for debugging)
   * @returns {Promise<ImageBitmap>}
   */
  loadImage(url, tileCoord) {
    return new Promise((resolve, reject) => {
      const id = this.#nextRequestId++;

      // Store promise handlers
      this.#pendingRequests.set(id, { resolve, reject });

      // Send to next worker (round-robin)
      const worker = this.#workers[this.#nextWorkerIndex];
      this.#nextWorkerIndex = (this.#nextWorkerIndex + 1) % this.#workers.length;

      worker.postMessage({ id, url, tileCoord });
    });
  }

  /**
   * Handle message from worker.
   * @param {MessageEvent} event
   */
  #handleWorkerMessage(event) {
    const { id, bitmap, error } = event.data;

    const pending = this.#pendingRequests.get(id);
    if (!pending) {
      console.warn(`TileLoaderWorkerPool: Received response for unknown request ${id}`);
      return;
    }

    this.#pendingRequests.delete(id);

    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(bitmap);
    }
  }

  /**
   * Handle worker error.
   * @param {ErrorEvent} event
   */
  #handleWorkerError(event) {
    console.error('TileLoaderWorkerPool: Worker error:', event.message);
  }

  /**
   * Terminate all workers and clean up.
   */
  destroy() {
    for (const worker of this.#workers) {
      worker.terminate();
    }
    this.#workers = [];
    this.#pendingRequests.clear();

    if (this.#workerBlobUrl) {
      URL.revokeObjectURL(this.#workerBlobUrl);
    }
  }
}

/***/ },

/***/ "./src/wgs/scene/leaflet/TileCoords.js"
/*!*********************************************!*\
  !*** ./src/wgs/scene/leaflet/TileCoords.js ***!
  \*********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TileCoords: () => (/* binding */ TileCoords),
/* harmony export */   index2Tile: () => (/* binding */ index2Tile),
/* harmony export */   tile2Index: () => (/* binding */ tile2Index)
/* harmony export */ });
/**
 * Helper struct to work with tile quadtree structure.
 * @constructor
 */
function TileCoords(level, x, y) {
  this.level = level;
  this.x = x;
  this.y = y;
}

TileCoords.prototype = {

  constructor: TileCoords,

  copy: function () {
    return new TileCoords(this.level, this.x, this.y);
  },

  /** returns {boolean} */
  isValid: function () {
    return Number.isInteger(this.level) && this.level >= 0 && Number.isInteger(this.x) && Number.isInteger(this.y);
  },

  /* @param   {number}     child - must be in [0,3]
   * @returns {TileCoords}
   */
  getChild: function (child) {

    var xOffset = child & 1 ? 1 : 0;
    var yOffset = child & 2 ? 1 : 0;
    return new TileCoords(
      this.level + 1,
      this.x * 2 + xOffset,
      this.y * 2 + yOffset
    );
  },

  /**
   *  @returns {TileCoords|null} Parent tile or null if this tile was root or invalid.
   */
  getParent: function () {
    if (this.level === 0) {
      return null;
    }
    return new TileCoords(this.level - 1, Math.floor(this.x / 2), Math.floor(this.y / 2));
  },

  /**
   *   Computes the subtree root at a given level. 'level' must be <= the current level.
   *    @param {number} level
   *    @returns {TileCoords|null}
   */
  getParentAtLevel: function (level) {
    if (level < 0 || level > this.level) {
      return null;
    }

    // compute level difference
    var levelDiff = this.level - level;

    // compute column and row at this level
    var c = Math.floor(this.x >> levelDiff);
    var r = Math.floor(this.y >> levelDiff);

    return new TileCoords(level, c, r);
  },

  /** @returns {string} E.g., "(1,1,2)" */
  toString: function () {
    return "(" + this.level + ", " + this.x + ", " + this.y + ")";
  },

  /**
   * Can be called either with a single TileCoords param or with (level, x, y) as integers.
   *   @param {TileCoords|number} levelOrTile
   *   @param {number}            [x]
   *   @param {number}            [y]
   *   @returns {boolean}
   */
  equals: function (levelOrTile, x, y) {

    if (levelOrTile instanceof TileCoords) {
      return this.equals(levelOrTile.level, levelOrTile.x, levelOrTile.y);
    }

    return this.level === levelOrTile && this.x === x && this.y === y;
  }
};

/** Computes the number of tiles at a given level, assuming a complete tree.
 *   @param   {number} level must be >=0
 *   @returns {number}
 */
function tilesAtLevel(level) {
  return 1 << level;
}

/**
 * Inverse of index2Tile (see below).
 * Note that this is only possible as long as all tiles share a common root tile (0,0,0).
 *  @param   {TileCoords}
 *  @returns {number}
 */
function tile2Index(tile) {

  // level 0 has 1 tile and the number of tiles grows by factor 4 with each level.
  // Using geometric sum formula, we obtain the summed number of tiles for
  // levels 0,...,tile.level-1 as:
  var firstTileInLevel = ((1 << 2 * tile.level) - 1) / 3;

  // compute individual index per row/column pair
  var tilesPerRow = 1 << tile.level;

  return firstTileInLevel + tile.y * tilesPerRow + tile.x;
}

/**
 * Enumerates all tiles of a complete quadtree in breadth-first order.
 *  @param   {number} index - Tile index, must be >= 0
 *  @returns {TileCoords}
 */
function index2Tile(index) {

  var tile = new TileCoords(0, 0, 0);

  // find level maximum level for which the index is <= the target index
  while (tile2Index(tile) <= index) {
    tile.level++;
  }
  tile.level--;

  // compute the local index inside this level
  var localIndex = index - tile2Index(tile);

  // Having the level, we can compute index and column
  var tilesPerRow = 1 << tile.level;
  tile.y = Math.floor(localIndex / tilesPerRow);
  tile.x = localIndex % tilesPerRow;

  return tile;
}

/***/ },

/***/ "./src/wgs/wgpu/CustomSampledTexture.js"
/*!**********************************************!*\
  !*** ./src/wgs/wgpu/CustomSampledTexture.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CustomSampledTexture: () => (/* binding */ CustomSampledTexture)
/* harmony export */ });
/**
 * !!! LIMITATION: Only ONE CustomSampledTexture *type* can be used per scene at a time. !!!
 *
 * The pipeline cache key (see getPipelineHash in Pipelines.js) only records *whether* a custom
 * sampled texture is present (a single bit), not *which* subclass/layout it is. If two different
 * CustomSampledTexture types (with different shader chunks or bind-group layouts) were used at the
 * same time, the first compiled pipeline would be wrongly reused for the second, causing a WebGPU
 * validation error or rendering with the wrong shader. This is fine today because VirtualTexture is
 * the only subclass. Before adding a second type, getPipelineHash must be extended to encode a
 * per-type/per-layout id (room exists in the high bits of shaderHash, which is an unbounded BigInt).
 *
 * Base class for textures whose sampling is implemented by custom shader code.
 *
 * A CustomSampledTexture instance can be assigned to a material as an alternative
 * to a regular sampled texture, e.g.:
 *
 *     material.customSampledTextures = { diffuse: myCustomTexture };
 *
 * Instead of being sampled as a normal 2D texture (via `material.map`), the
 * instance contributes a WGSL chunk to the uber shader and an additional bind
 * group (group 3) that provides whatever GPU resources it needs.
 *
 * Subclasses (e.g. VirtualTexture) implement these hooks to inject custom
 * sampling logic — for example, virtual texture lookup with feedback.
 *
 * Notes:
 *  - Only supported in WebGPU.
 *  - Currently only the `diffuse` slot is supported; more slots may be added.
 *  - If both `material.map` and `material.customSampledTextures.diffuse` are set,
 *    the custom sampled texture wins (the regular textureSample call is bypassed
 *    in uber.wgsl when a non-empty chunk is provided). The regular `.map` binding
 *    is still created but not sampled.
 */
class CustomSampledTexture {

  /**
   * Returns top-level WGSL injected into the uber shader. The chunk MUST define
   * the following function with this exact signature:
   *
   *     fn sampleCustomTexture(in: CustomTextureInputs) -> vec4f
   *
   * which returns the new diffuse value (vec4f). The function REPLACES the
   * regular diffuse texture sampling step. It receives a single struct input:
   *
   *     struct CustomTextureInputs {
   *         prevDiffuse: vec4f,  // diffuse value before this stage runs
   *         uv:          vec2f,  // interpolated 2D UV
   *         fragCoord:   vec2f,  // in.Position.xy (screen-space pixel coord)
   *     }
   *
   * Side effects are allowed (e.g. writing to a feedback buffer for tile streaming).
   *
   * The chunk is placed at top level, so it may also include `@group/@binding`
   * declarations and helper functions used by `sampleCustomTexture`.
   *
   * The framework owns the applicability gate: this is only called for UV-bearing
   * triangle geometry (custom textures need UVs to sample), so implementations may
   * assume UVs are present.
   *
   * Note: Implementation must always return a non-empty chunk.
   *
   * @param {Object} geomContext
   * @param {boolean} geomContext.isUVW          - true if UVs are 3-component
   * @param {boolean} geomContext.includeNormals - true if the shape has normals (lit pipeline)
   * @returns {string} WGSL chunk defining sampleCustomTexture().
   */
  getShaderChunk(geomContext) {// eslint-disable-line no-unused-vars
    throw new Error('CustomSampledTexture.getShaderChunk() must be overridden');
  }

  /**
   * Returns the GPU bind-group layout for the resources declared by
   * getShaderChunk(). Bound at group 3 by UberPipeline.
   *
   * @returns {GPUBindGroupLayout}
   */
  getBindGroupLayout() {
    throw new Error('CustomSampledTexture.getBindGroupLayout() must be overridden');
  }

  /**
   * Returns the GPU bind-group matching getBindGroupLayout().
   *
   * @returns {GPUBindGroup}
   */
  getBindGroup() {
    throw new Error('CustomSampledTexture.getBindGroup() must be overridden');
  }
}

/***/ },

/***/ "./src/wgs/wgsl-preprocessor/wgsl-preprocessor.js"
/*!********************************************************!*\
  !*** ./src/wgs/wgsl-preprocessor/wgsl-preprocessor.js ***!
  \********************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   $wgsl: () => (/* binding */ $wgsl),
/* harmony export */   wgsl: () => (/* reexport safe */ wgsl_preprocessor_wgsl_preprocessor__WEBPACK_IMPORTED_MODULE_0__.wgsl)
/* harmony export */ });
/* harmony import */ var wgsl_preprocessor_wgsl_preprocessor__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! wgsl-preprocessor/wgsl-preprocessor */ "./node_modules/wgsl-preprocessor/wgsl-preprocessor.js");

/**
 * Checks if there is "enough" `values` for the given `tokens`.
 * Expects `tokens` to be an existing array.
 */
function check(tokens, values) {
  if (!values || values.length < tokens.length) {
    const noValues = tokens.slice(values?.length || 0).map((t) => `"$${t}"`).join(', ');
    throw new Error(`[wgpu] Missing values for: ${noValues}`);
  }
  return values;
}

/**
 * Reifies `$...` tokens in wgsl shaders. `...` should follow the `\w+` pattern to be discoverable.
 *
 * Supported cases depending on a type of `values`:
 * - if `values` is a primitive, rest arguments after `code` will be used as token values;
 * - if `values` is an object, it's used as a simple single-level dictionary, e.g.,
 *   for the object `{ foo: 'bar' }`, `bar` replaces the token `$foo`;
 * - if `values` is an array, tokens are replaced with its elements by order of their occurence.
 *
 * In each of the non-primitive cases, rest `...args` is ignored.
*/
function $wgsl(code, values, ...args) {
  const $ = /\$\w+/;
  const tokens = code.match(/(?<=\$)(\w+)/g);
  if (!tokens || !tokens.length) return code;

  if (Array.isArray(values)) {
    return (0,wgsl_preprocessor_wgsl_preprocessor__WEBPACK_IMPORTED_MODULE_0__.wgsl)(code.split($), ...check(tokens, values));
  }
  if (values && !Array.isArray(values) && typeof values === 'object') {
    return (0,wgsl_preprocessor_wgsl_preprocessor__WEBPACK_IMPORTED_MODULE_0__.wgsl)(code.split($), ...tokens.map((token) => {
      if (!Object.hasOwn(values, token)) {
        throw new Error(`[wgpu] Missing value for "$${token}"`);
      }
      const value = values[token];
      if (typeof value === 'object' && value !== null || typeof value === 'function') {
        throw new Error(`[wgpu] Unsupported value type "${typeof value}"`);
      }
      return value;
    }));
  }
  return (0,wgsl_preprocessor_wgsl_preprocessor__WEBPACK_IMPORTED_MODULE_0__.wgsl)(code.split($), ...check(tokens, [values, ...args]));
}



/***/ },

/***/ "./extensions/VirtualTextures/core/virtual_texture.wgsl"
/*!**************************************************************!*\
  !*** ./extensions/VirtualTextures/core/virtual_texture.wgsl ***!
  \**************************************************************/
(module) {

"use strict";
module.exports = "/*\nVirtual Texture Chunk - injected into fragment shaders to override the standard 2D texture sampling.\nResponsibilities:\n - tile feedback: Track in a storage buffer which tiles we needed\n - lookup: Find proper tile from the GPU tile atlas (via the resident-tile hash page table)\n - UV transforms - transform from global virtualtexture coords to local uv's within a tile\n - sampling\n\nBINDINGS (all on vtBindGroup, default group 3):\n  - binding 0: vtParams uniform (VirtualTextureParams)\n  - binding 1: cacheTexture (texture_2d)\n  - binding 2: tileLookup (storage buffer, read)\n  - binding 4: feedbackBuffer (storage buffer, read_write, atomic) - tile feedback\n  - binding 101: cacheSampler\n\nENTRY POINTS (called from the injecting fragment shader, see VirtualTexture.js):\n  - writeTileFeedback(uv, fragCoord, slot) : record the needed tile via atomicMax\n  - virtualTextureSample(uv) -> vec4f : sample the VT (magenta if nothing cached)\n*/\n\nstruct VirtualTextureParams {\n    virtualSizeX: i32,     // Virtual texture width in tiles (at max level)\n    virtualSizeY: i32,     // Virtual texture height in tiles (at max level)\n    gridSize: i32,         // Cache grid size (tiles per row/column)\n    tileSize: i32,         // Tile size in pixels\n    borderSize: i32,       // Border size in pixels (padding around each tile)\n    discardTransparent: i32, // When != 0, discard transparent fragments (for tile feedback capture)\n    feedbackGridSize: i32, // Feedback buffer grid dimension (e.g. 128 = 128x128 cells)\n    viewportWidth: i32,    // Viewport width in pixels (for feedback grid mapping)\n    viewportHeight: i32,   // Viewport height in pixels (for feedback grid mapping)\n    maxAnisotropy: i32,    // Max anisotropic-filtering ratio (1 = isotropic). Must match the sampler's.\n    pageTableSize: i32,    // Hash page-table slot count (power of two; mask = size - 1).\n    pageTableProbe: i32,   // Fixed probe budget, i.e. maximum number of slots we search linearly in the hash table if we don't\n                           // find the tile at the hashIndex; If we give up, we just try the parent tile.\n    // Region: the rectangle of virtual (leaf-level) pixel space that this\n    // material's uv [0,1] maps onto. Lets several materials share one virtual\n    // texture, each addressing a different sub-region, AND fixes float32 uv\n    // precision at deep levels: the mesh stores LOCAL uv over a small region,\n    // so the interpolated varying keeps full precision; the (large) global\n    // offset is re-added here in integer space (see vtAxisLoc). The default\n    // region (origin 0, size = full texture) reproduces the legacy whole-\n    // texture mapping exactly. Units: leaf-level virtual pixels.\n    // NOTE: i32 for now (covers leaf level <= ~23); a u64 hi/lo split is the\n    // planned extension for deeper pyramids with a non-trivial origin.\n    regionPxX: i32,      // region origin X (leaf px, left edge)\n    regionPxY: i32,      // region origin Y (leaf px, top edge; y is top-down)\n    regionPxW: i32,      // region width  (leaf px)\n    regionPxH: i32,      // region height (leaf px)\n}\n@group($vtBindGroup) @binding($vtParamsBinding) var<uniform> vtParams: VirtualTextureParams;\n\n// Cache atlas texture and sampler\n@group($vtBindGroup) @binding($vtCacheTextureBinding) var vtCacheTexture: texture_2d<f32>;\n@group($vtBindGroup) @binding($vtCacheSamplerBinding) var vtCacheSampler: sampler;\n\n// Tile lookup buffer: an open-addressing hash table of resident tiles, 3 u32 per\n// slot — [keyLo = tileX, keyHi = (level<<26)|tileY, value]. value packs the cache\n// position (cacheX (8 bits) | cacheY << 8 | validFlag << 24); value == 0 marks an\n// empty slot. Must match TilePageTable.js (#home / encodeKey / packTileLookup).\n@group($vtBindGroup) @binding($vtTileLookupBinding) var<storage, read> vtTileLookup: array<u32>;\n\n// ============================================================================\n// Tile Feedback Storage Buffer - track which tiles were needed\n// ============================================================================\n\n// Storing for every pixel would be too expensive. So, we only track a \"grid\" of any n-th pixel.\n// Note: In theory, it's suboptimal that some pixels keep untracked. In theory, we may improve this\n// by shifting the grid every frame. However, I didn't encounter a case so far that would\n// justify the resoluting extra complexity.\n//\n// Feedback buffer: 2 logical slots per grid cell (slot 0 = opaque, slot 1 =\n// transparent), each slot is 3 atomic<u32> words: [key, xFull, yFull].\n//\n//   key   = ((level+1) << 26) | ((tileY & 0x1FFF) << 13) | (tileX & 0x1FFF)\n//   xFull = absolute tile X (full 32 bits), yFull = absolute tile Y\n//\n// The key drives an atomicMax so the finest level per cell wins ((level+1) in\n// the top 6 bits keeps a present entry non-zero; 0 = empty). The full coords are\n// published by whichever fragment raised the max. The 13 low bits of x/y in the\n// key let the CPU detect the rare atomic race (a late companion-store landing\n// after the winner's) and skip that cell for the frame — see\n// TileFeedbackProcessor. This lifts the old 13-bit/leaf-level-12 limit: levels\n// up to 62 with full 32-bit coords are now addressable.\n//\n// MUST stay in sync with TileFeedbackProcessor (FEEDBACK_WORDS_PER_SLOT, unpack).\n@group($vtBindGroup) @binding($vtFeedbackBufferBinding) var<storage, read_write> vtFeedbackBuffer: array<atomic<u32>>;\n\n// Write tile feedback to the storage buffer.\n// slot: 0 = opaque, 1 = transparent (separate slots to avoid competition)\nfn writeTileFeedback(virtualUV: vec2f, fragCoord: vec2f, slot: u32) {\n    let gridSize = u32(vtParams.feedbackGridSize);\n    if (gridSize == 0u) { return; }\n\n    let cellX = min(u32(fragCoord.x * f32(gridSize) / f32(vtParams.viewportWidth)), gridSize - 1u);\n    let cellY = min(u32(fragCoord.y * f32(gridSize) / f32(vtParams.viewportHeight)), gridSize - 1u);\n    let cellIndex = cellY * gridSize + cellX;\n\n    let level = computeDesiredLevel(virtualUV);\n    let tileCoord = getTileAtLevel(virtualUV, level);\n\n    let key = ((u32(level) + 1u) << 26u) | ((tileCoord.y & 0x1fffu) << 13u) | (tileCoord.x & 0x1fffu);\n\n    let base = (cellIndex * 2u + slot) * 3u;\n    let prev = atomicMax(&vtFeedbackBuffer[base], key);\n    if (key > prev) {\n        // We raised the per-cell max: publish the full coords. A coarser writer\n        // that passed its own check earlier can still interleave its stores after\n        // ours, but then the low-bit check on the CPU fails and the cell is\n        // skipped for this frame (it self-corrects on the next).\n        atomicStore(&vtFeedbackBuffer[base + 1u], tileCoord.x);\n        atomicStore(&vtFeedbackBuffer[base + 2u], tileCoord.y);\n    }\n}\n\n// ============================================================================\n// Tile Feedback Helper Functions\n// ============================================================================\n\n// VT leaf level (finest), derived from the global pyramid size in tiles.\nfn vtMaxLevel() -> i32 {\n    return i32(log2(f32(max(vtParams.virtualSizeX, vtParams.virtualSizeY))));\n}\n\n// Continuous desired VT level from UV derivatives (f32, not rounded).\n// Higher = finer (level 0 = root, maxLevel = leaf).\n//\n// Anisotropic-aware (OpenGL/Vulkan spec; Mayer thesis Program 6): instead of the\n// isotropic max-axis footprint, we pick the mip from the *minor* axis and let the\n// HW aniso filter average along the *major* axis. Concretely the selected mip is\n// log2(aniso) finer than isotropic, where aniso = minor/major ratio capped at\n// maxAnisotropy. With maxAnisotropy == 1 this reduces exactly to the simpler isotropic\n// formula (aniso == 1 -> mipLevel == 0.5*log2(Pmax) == log2(maxAxisLength)).\nfn computeDesiredLevelF(virtualUV: vec2f) -> f32 {\n    let dUVdx = dpdx(virtualUV);\n    let dUVdy = dpdy(virtualUV);\n\n    // uv now spans only the region, so one unit of uv covers regionPx leaf\n    // pixels (not the whole texture). With the default full-texture region\n    // these equal virtualSize*tileSize, reproducing the legacy footprint.\n    let virtualPixelsX = f32(vtParams.regionPxW);\n    let virtualPixelsY = f32(vtParams.regionPxH);\n    let dPixelsdx = dUVdx * vec2f(virtualPixelsX, virtualPixelsY);\n    let dPixelsdy = dUVdy * vec2f(virtualPixelsX, virtualPixelsY);\n\n    // Squared footprint lengths of the two screen-space axes (in virtual texels).\n    let px2 = dot(dPixelsdx, dPixelsdx);\n    let py2 = dot(dPixelsdy, dPixelsdy);\n    let Pmax = max(px2, py2);\n    let Pmin = max(min(px2, py2), 1e-12);          // guard against div-by-zero\n\n    let maxAniso = max(1.0, f32(vtParams.maxAnisotropy));\n    let aniso = clamp(sqrt(Pmax / Pmin), 1.0, maxAniso);\n\n    // 0.5*log2(Pmax) is the isotropic mip; subtract log2(aniso) to go finer.\n    let mipLevel = max(0.0, 0.5 * log2(Pmax / (aniso * aniso)));\n    let maxLevel = log2(f32(max(vtParams.virtualSizeX, vtParams.virtualSizeY)));\n\n    return clamp(maxLevel - mipLevel, 0.0, maxLevel);\n}\n\n// Integer desired level (for feedback / page-table lookups).\n// Uses the standard sqrt(2) rounding bias so the crossover between two levels\n// happens at the geometric mean of their texel densities.\nfn computeDesiredLevel(virtualUV: vec2f) -> i32 {\n    let maxLevel = vtMaxLevel();\n    return clamp(i32(computeDesiredLevelF(virtualUV) + 0.5), 0, maxLevel);\n}\n\n// One axis of a virtual-pixel position resolved to (tile index, frac-in-tile)\n// at a given level, WITHOUT ever forming the large global pixel coordinate in\n// f32 (which is what loses precision at deep levels).\n//\n//   global leaf pixel = originPx (integer constant) + localPx (small f32)\n//\n// We split the integer origin by the per-level tile span (a power of two, so\n// div/mod are exact), and only the small remainder + localPx go through f32:\n//   tile = originPx/span + floor((originPx%span + localPx)/span)\n//   frac = fract((originPx%span + localPx)/span)\n// With the default region (origin 0, size = full texture) and a whole-texture\n// localPx = uv*virtualPixels, this reduces exactly to floor(uv*2^level).\nstruct VTAxisLoc {\n    tile: u32,\n    frac: f32,\n}\nfn vtAxisLoc(originPx: u32, localPx: f32, level: i32, maxLevel: i32) -> VTAxisLoc {\n    // span = leaf pixels covered by one tile at this level (power of two).\n    let span = u32(vtParams.tileSize) << u32(maxLevel - level);\n    let spanF = f32(span);\n    // Split the global address into an integer origin tile (originPx/span, exact) and\n    // a within-origin-tile remainder. Only the small remainder + localPx go through f32,\n    // preserving precision. combined is the leaf-pixel offset relative to the origin tile.\n    let combined = f32(originPx % span) + max(localPx, 0.0);\n    // q = how many whole tiles combined spans past the origin tile.\n    let q = floor(combined / spanF);\n    var out: VTAxisLoc;\n    // out.tile may exceed maxTile when localPx > span (e.g. a region wider than one\n    // tile at a coarse level). That is fine: getTileAtLevel() clamps tile to maxTile,\n    // and the only other caller (vtResolvedToCacheUV) reads only out.frac, which is\n    // clamped to [0,1] below. So no caller ever uses an out-of-range tile index.\n    // Final tile = integer origin tile + whole tiles spanned; frac = position within tile.\n    out.tile = (originPx / span) + u32(q);\n    out.frac = clamp(combined / spanF - q, 0.0, 1.0);\n    return out;\n}\n\n// 2D virtual-pixel position (from local region uv) -> (tile, frac) at a level.\n// y is flipped to top-down because tiles use a top-left origin while uv is\n// bottom-left, then mapped through the region rectangle.\nstruct VTLoc {\n    tile: vec2u,\n    frac: vec2f,\n}\nfn vtLocAtLevel(virtualUV: vec2f, level: i32) -> VTLoc {\n    let maxLevel = vtMaxLevel();\n    let safeUV = clamp(virtualUV, vec2f(0.0), vec2f(0.999999));\n    let localPxX = safeUV.x * f32(vtParams.regionPxW);\n    // Keep Y symmetric with X: the (1 - y) flip would let localPxY reach regionPxH\n    // exactly at safeUV.y == 0, pushing out.tile one past the last valid tile. Clamp\n    // it just below regionPxW/H so both axes stay strictly inside the region.\n    let localPxY = min((1.0 - safeUV.y) * f32(vtParams.regionPxH), 0.999999 * f32(vtParams.regionPxH));\n    let ax = vtAxisLoc(u32(vtParams.regionPxX), localPxX, level, maxLevel);\n    let ay = vtAxisLoc(u32(vtParams.regionPxY), localPxY, level, maxLevel);\n    var out: VTLoc;\n    out.tile = vec2u(ax.tile, ay.tile);\n    out.frac = vec2f(ax.frac, ay.frac);\n    return out;\n}\n\n// Compute tile coordinates at a given VT level.\n// At level N, we have 2^N tiles per axis (level 0 = root = 1 tile).\nfn getTileAtLevel(virtualUV: vec2f, level: i32) -> vec2u {\n    let maxTile = (1u << u32(level)) - 1u;\n    let loc = vtLocAtLevel(virtualUV, level);\n    return min(loc.tile, vec2u(maxTile, maxTile));\n}\n\n// ============================================================================\n// Virtual Texture Lookup Functions\n// ============================================================================\n\n// Unpacks a tile lookup entry into (cacheX, cacheY, validFlag).\nfn vtUnpackTileLookup(packed: u32) -> vec3u {\n    return vec3u(\n        packed & 0xFFu,           // cacheX\n        (packed >> 8u) & 0xFFu,   // cacheY\n        (packed >> 24u) & 0x1u    // valid flag\n    );\n}\n\n// ----------------------------------------------------------------------------\n// Hash page table\n//\n// vtTileLookup is a flat array of slots, 3 u32 each:\n//   [keyLo = tileX, keyHi = (level<<26)|tileY, value = packed cache coords].\n// value == 0 marks an empty slot. Open addressing + linear probing; an empty\n// slot ends the chain (the CPU side uses backward-shift deletion, so chains are\n// always contiguous). This MUST match TilePageTable.js (#home / encodeKey).\n// ----------------------------------------------------------------------------\n\n// Slot index for a tile's home position. Identical integer hash to the CPU side.\nfn vtHashHome(level: i32, x: u32, y: u32) -> u32 {\n    let mask = u32(vtParams.pageTableSize) - 1u;\n    let h = (x * 73856093u) ^ (y * 19349663u) ^ (u32(level) * 83492791u);\n    return h & mask;\n}\n\n// Probe the hash table for the exact tile (level,x,y). Returns (cacheX, cacheY,\n// valid); valid == 0 if not resident (or probe budget exhausted -> caller walks up).\nfn vtHashLookup(level: i32, x: u32, y: u32) -> vec3u {\n    let mask = u32(vtParams.pageTableSize) - 1u;\n    let lo = x;\n    let hi = ((u32(level) & 0x3fu) << 26u) | (y & 0x3ffffffu);\n    var idx = vtHashHome(level, x, y);\n    let budget = u32(vtParams.pageTableProbe);\n    for (var p = 0u; p < budget; p = p + 1u) {\n        let base = idx * 3u;\n        let value = vtTileLookup[base + 2u];\n        if (value == 0u) {\n            return vec3u(0u, 0u, 0u); // empty slot ends the chain -> miss\n        }\n        if (vtTileLookup[base] == lo && vtTileLookup[base + 1u] == hi) {\n            return vtUnpackTileLookup(value);\n        }\n        idx = (idx + 1u) & mask;\n    }\n    return vec3u(0u, 0u, 0u); // budget exhausted -> treat as miss (walk up to parent)\n}\n\n// Result of resolving a UV to a resident tile via the hash page table.\nstruct VTResolved {\n    valid: u32,       // 1 if a resident tile was found\n    cacheX: u32,      // cache grid column of the resident tile\n    cacheY: u32,      // cache grid row of the resident tile\n    usedLevel: i32,   // level of the resident tile actually used\n    tileX: u32,       // tile X at usedLevel\n    tileY: u32,       // tile Y at usedLevel\n};\n\n// Walk up from startLevel until a resident entry is found (pinned root\n// guarantees a hit). Callers pass an explicit start level so the same\n// walk-up can serve both the derivative-based resolve and the trilinear\n// bracket levels.\nfn vtResolveAtLevel(virtualUV: vec2f, startLevel: i32) -> VTResolved {\n    let maxLevel = vtMaxLevel();\n    var level = clamp(startLevel, 0, maxLevel);\n\n    // getTileAtLevel already clamps to the level's maxTile, so no extra min here.\n    let tile = getTileAtLevel(virtualUV, level);\n    var tx = tile.x;\n    var ty = tile.y;\n\n    var out: VTResolved;\n    out.valid = 0u;\n    loop {\n        let lookup = vtHashLookup(level, tx, ty);\n        if (lookup.z != 0u) {\n            out.valid = 1u;\n            out.cacheX = lookup.x;\n            out.cacheY = lookup.y;\n            out.usedLevel = level;\n            out.tileX = tx;\n            out.tileY = ty;\n            break;\n        }\n        if (level == 0) { break; }\n        level = level - 1;\n        tx = tx >> 1u;\n        ty = ty >> 1u;\n    }\n    return out;\n}\n\n// Map a resolved tile + virtual UV to an atlas cache UV.\nfn vtResolvedToCacheUV(r: VTResolved, virtualUV: vec2f) -> vec2f {\n    // frac is relative to the tile at usedLevel; because integer floor-division\n    // commutes with the walk-up (tile>>1 == tile at the coarser level), this\n    // frac matches the resolved tile (r.tileX/Y) exactly.\n    let loc = vtLocAtLevel(virtualUV, r.usedLevel);\n    let fracX = loc.frac.x;\n    let fracY = loc.frac.y;\n\n    let gridSize = f32(vtParams.gridSize);\n    let tileSize = f32(vtParams.tileSize);\n    let borderSize = f32(vtParams.borderSize);\n    let tileSizeWithBorder = tileSize + 2.0 * borderSize;\n    let atlasSize = tileSizeWithBorder * gridSize;\n\n    let pixelX = f32(r.cacheX) * tileSizeWithBorder + borderSize + fracX * (tileSize - 1.0);\n    let pixelY = f32(r.cacheY) * tileSizeWithBorder + borderSize + fracY * (tileSize - 1.0);\n\n    return vec2f(clamp(pixelX / atlasSize, 0.0, 1.0),\n                 clamp(pixelY / atlasSize, 0.0, 1.0));\n}\n\n// Per-axis scale mapping a virtual-UV derivative to an atlas cache-UV derivative,\n// for a tile resolved at usedLevel. The Jacobian of vtResolvedToCacheUV is diagonal:\n//   d(cacheU)/d(virtU) = +S.x,   d(cacheV)/d(virtV) = -S.y\n// (the V axis flips because cacheUV uses 1 - virtualUV.y). Chain rule through\n// localPx = uv*regionPx -> frac = localPx/spanF -> cache = frac*(tileSize-1)/atlasSize:\n//   S = regionPx/(virtualSize*tileSize) * 2^usedLevel * (tileSize-1) / atlasSize,\n//   atlasSize = (tileSize+2*border)*gridSize.\n// The region factor accounts for one unit of virtualUV covering only regionPxW/H leaf\n// px (not the whole texture). It differs per axis for non-square regions, hence vec2f.\n// For the default full-texture region regionPx == virtualSize*tileSize -> factor 1.\nfn vtCacheUVGradScale(usedLevel: i32) -> vec2f {\n    let gridSize = f32(vtParams.gridSize);\n    let tileSize = f32(vtParams.tileSize);\n    let borderSize = f32(vtParams.borderSize);\n    let atlasSize = (tileSize + 2.0 * borderSize) * gridSize;\n    let base = (tileSize - 1.0) * f32(1u << u32(usedLevel)) / atlasSize;\n    let fx = f32(vtParams.regionPxW) / (f32(vtParams.virtualSizeX) * tileSize);\n    let fy = f32(vtParams.regionPxH) / (f32(vtParams.virtualSizeY) * tileSize);\n    return vec2f(base * fx, base * fy);\n}\n\n// Anisotropic-aware atlas sample for a resolved tile. Feeds textureSampleGrad\n// explicit gradients corrected from virtual-UV space to atlas-UV space, so the\n// HW aniso filter spreads its taps along the *virtual* texel footprint (the raw\n// atlas UVs are discontinuous at tile seams and would give wrong footprints).\n// Note: textureSampleGrad takes explicit gradients, so it is valid in non-uniform\n// control flow (unlike textureSample). The caller computes duvdx/duvdy in uniform\n// control flow and passes them in.\nfn vtSampleResolvedGrad(r: VTResolved, virtualUV: vec2f, duvdx: vec2f, duvdy: vec2f) -> vec4f {\n    let uv = vtResolvedToCacheUV(r, virtualUV);\n    let s = vtCacheUVGradScale(r.usedLevel);\n    let gradX = duvdx * vec2f(s.x, -s.y);\n    let gradY = duvdy * vec2f(s.x, -s.y);\n    return textureSampleGrad(vtCacheTexture, vtCacheSampler, uv, gradX, gradY);\n}\n\n// Main VT sample: resolve the two VT levels bracketing the continuous LOD,\n// anisotropically sample each from the atlas (textureSampleGrad with corrected\n// gradients), and blend by the fractional part. The hierarchical residency\n// invariant guarantees the coarser parent is always resident, so the coarse\n// bracket always resolves (worst case: root).\n//\n// Two layers of filtering combine here:\n//  - intra-level (within a tile): HW anisotropy via textureSampleGrad (mip 0 taps)\n//  - inter-level (across VT tile levels): the manual two-lookup mix() below\nfn virtualTextureSample(virtualUV: vec2f) -> vec4f {\n    // dpdx/dpdy must be evaluated in uniform control flow (before any branching).\n    let duvdx = dpdx(virtualUV);\n    let duvdy = dpdy(virtualUV);\n\n    let maxLevel = vtMaxLevel();\n    let lf = clamp(computeDesiredLevelF(virtualUV), 0.0, f32(maxLevel));\n    let lFine   = i32(ceil(lf));\n    let lCoarse = i32(floor(lf));\n    let w = lf - f32(lCoarse);  // 0 = pure coarse, 1 = pure fine\n\n    let rFine   = vtResolveAtLevel(virtualUV, lFine);\n    let rCoarse = vtResolveAtLevel(virtualUV, lCoarse);\n\n    if (rCoarse.valid == 0u) {\n        return vec4f(1.0, 0.0, 1.0, 1.0); // magenta: nothing cached\n    }\n\n    let colorCoarse = vtSampleResolvedGrad(rCoarse, virtualUV, duvdx, duvdy);\n\n    if (lFine == lCoarse || rFine.valid == 0u) {\n        return colorCoarse;\n    }\n\n    let colorFine = vtSampleResolvedGrad(rFine, virtualUV, duvdx, duvdy);\n\n    return mix(colorCoarse, colorFine, w);\n}\n";

/***/ },

/***/ "./node_modules/wgsl-preprocessor/wgsl-preprocessor.js"
/*!*************************************************************!*\
  !*** ./node_modules/wgsl-preprocessor/wgsl-preprocessor.js ***!
  \*************************************************************/
(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   wgsl: () => (/* binding */ wgsl)
/* harmony export */ });
/** WGSL Preprocessor v1.0.1 **/
const preprocessorSymbols = /#([^\s]*)(\s*)/gm

class ConditionalState {
  elseIsValid = true;
  branches = [];

  constructor(initialExpression) {
    this.pushBranch('if', initialExpression);
  }

  pushBranch(token, expression) {
    if (!this.elseIsValid) {
      throw new Error(`#${token} not preceeded by an #if or #elif`);
    }
    this.elseIsValid = (token === 'if' || token === 'elif');
    this.branches.push({
      expression: !!expression,
      string: ''
    });
  }

  appendStringToCurrentBranch(...strings) {
    for (const string of strings) {
      this.branches[this.branches.length-1].string += string;
    }
  }

  resolve() {
    for (const branch of this.branches) {
      if (branch.expression) {
        return branch.string;
      }
    }

    return '';
  }
}

// Template literal tag that handles simple preprocessor symbols for WGSL
// shaders. Supports #if/elif/else/endif statements.
function wgsl(strings, ...values) {
  const stateStack = [];
  let state = new ConditionalState(true);
  state.elseIsValid = false;
  let depth = 1;

  const assertTemplateFollows = (match, string) => {
    if (match.index + match[0].length != string.length) {
      throw new Error(`#${match[1]} must be immediately followed by a template expression (ie: \${value})`);
    }
  }

  for (let i = 0; i < strings.length; ++i) {
    const string = strings[i];
    const matchedSymbols = string.matchAll(preprocessorSymbols);

    let lastIndex = 0;
    let valueConsumed = false;

    for (const match of matchedSymbols) {
      state.appendStringToCurrentBranch(string.substring(lastIndex, match.index));

      switch (match[1]) {
        case 'if':
          assertTemplateFollows(match, string);

          valueConsumed = true;
          stateStack.push(state);
          state = new ConditionalState(values[i]);
          break;
        case 'elif':
          assertTemplateFollows(match, string);

          valueConsumed = true;
          state.pushBranch(match[1], values[i]);
          break;
        case 'else':
          state.pushBranch(match[1], true);
          state.appendStringToCurrentBranch(match[2]);
          break;
        case 'endif':
          if (!stateStack.length) {
            throw new Error(`#${match[1]} not preceeded by an #if`);
          }

          const result = state.resolve();

          state = stateStack.pop();
          state.appendStringToCurrentBranch(result, match[2]);
          break;
        default:
          // Unknown preprocessor symbol. Emit it back into the output string unchanged.
          state.appendStringToCurrentBranch(match[0]);
          break;
      }

      lastIndex = match.index + match[0].length;
    }

    // If the string didn't end on one of the preprocessor symbols append the rest of it here.
    if (lastIndex != string.length) {
      state.appendStringToCurrentBranch(string.substring(lastIndex, string.length));
    }

    // If the next value wasn't consumed by the preprocessor symbol, append it here.
    if (!valueConsumed && values.length > i) {
      state.appendStringToCurrentBranch(values[i]);
    }
  }

  if (stateStack.length) {
    throw new Error('Mismatched #if/#endif count');
  }

  return state.resolve();
}

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be in strict mode.
(() => {
"use strict";
/*!*******************************************************!*\
  !*** ./extensions/VirtualTextures/VirtualTextures.js ***!
  \*******************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   VirtualTextures: () => (/* binding */ VirtualTextures)
/* harmony export */ });
/* harmony import */ var _core_VirtualTextureCache_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./core/VirtualTextureCache.js */ "./extensions/VirtualTextures/core/VirtualTextureCache.js");
/* harmony import */ var _tilesources_LeafletTileSource_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./tilesources/LeafletTileSource.js */ "./extensions/VirtualTextures/tilesources/LeafletTileSource.js");
/* harmony import */ var _core_VirtualTexture_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./core/VirtualTexture.js */ "./extensions/VirtualTextures/core/VirtualTexture.js");
/* harmony import */ var _core_TileFeedbackLoop_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./core/TileFeedbackLoop.js */ "./extensions/VirtualTextures/core/TileFeedbackLoop.js");





/**
 * VirtualTextures - Virtual texture streaming for WebGPU.
 *
 * Provides tile-based texture streaming with feedback-driven tile loading.
 *
 * Known limitation: each attach() builds a fully independent stack — its own
 * VirtualTextureCache (and thus its own GPUTileAtlas, page table, and
 * feedback buffer), its own TileFeedbackLoop (with a TileFeedbackProcessor), and its
 * own per-frame readback.
 * Multiple virtual textures in a scene therefore duplicate GPU memory (no shared
 * atlas even when tiles overlap), each run a separate feedback readback per
 * presented frame, and apply maxLoadsPerFrame per-cache rather than via a global
 * budget. Sharing would require one shared GPUTileAtlas with a page-table per
 * virtual texture — a larger design change not yet done.
 *
 * @example
 * const vt = await viewer.loadExtension('Autodesk.VirtualTextures');
 */
class VirtualTextures extends Autodesk.Viewing.Extension {

  /** @type {VTAttachHandle[]} Active attachments, so they can be cleaned up on unload. */
  #handles = [];

  constructor(viewer, options) {
    super(viewer, options);
  }

  /** @returns {GPUDevice|null} */
  #getDevice() {
    return this.viewer.impl?.glrenderer?.()?.getDevice?.() ?? null;
  }

  /**
   * Called when the extension is loaded.
   * @returns {boolean} True if the extension loaded successfully.
   */
  load() {
    return true;
  }

  /**
   * Called when the extension is unloaded.
   * @returns {boolean} True if the extension unloaded successfully.
   */
  unload() {
    // Detach all active attachments (clone the list, detach() mutates it).
    for (const handle of [...this.#handles]) {
      this.detach(handle);
    }
    this.deactivate();
    return true;
  }

  /**
   * @typedef {Object} VTAttachHandle
   * @property {VirtualTextureCache} cache - The tile cache backing this attachment.
   * @property {THREE.Material} material - The material the VT was attached to.
   * @property {Object} tileSource - The tile source feeding the cache.
   * @property {import('./core/TileFeedbackLoop.js').TileFeedbackLoop} _loop - The refine loop driving this attachment.
   */

  /**
   * Attach virtual-texture streaming to a material's diffuse channel.
   *
   * This is the one-call entry point for end users: it creates the tile cache,
   * wires it into the material via the renderer's CustomSampledTexture interface,
   * and runs the feedback-driven auto-refine loop (sample visible tiles -> request
   * -> upload -> redraw) for as long as the attachment lives.
   *
   * The material must be used by geometry that has UV coordinates.
   *
   * @param {Object} options
   * @param {THREE.Material} options.material - Material to render through VT.
   * @param {Object} [options.tileSource] - A tile source (ITileSource). Takes precedence over `leaflet`.
   * @param {Object} [options.leaflet] - Convenience config to build a LeafletTileSource.
   * @param {string} options.leaflet.baseUrl - Base URL of the tile pyramid.
   * @param {string} [options.leaflet.urlTemplate] - URL template, e.g. '{baseUrl}/{level}/{y}/{x}'.
   * @param {number} [options.leaflet.maxLevel] - Max level index; defaults to match virtualResolution.
   * @param {number} [options.leaflet.width] - Full image width in px; defaults to virtualResolution.
   * @param {number} [options.leaflet.height] - Full image height in px; defaults to virtualResolution.
   * @param {string} [options.leaflet.cacheBucket] - Optional OPFS cache bucket.
   * @param {number} [options.tileSize=256] - Tile size in pixels.
   * @param {number} [options.gridSize=32] - Physical cache size (resident tiles per axis).
   * @param {number} [options.virtualResolution=262144] - Virtual texture size in pixels per axis.
   * @param {number} [options.pinnedLevels=2] - Number of coarse mip levels kept resident.
   * @param {number} [options.maxLoadsPerFrame=8] - Max tile loads kicked off per frame.
   * @param {number} [options.anisotropy=1] - Max anisotropic-filtering ratio (1 = isotropic/trilinear).
   *        The atlas border width is derived from this (borderSize = ceil(anisotropy/2)),
   *        since the aniso footprint can reach anisotropy/2 texels past a tile edge.
   * @param {{x:number,y:number,w:number,h:number}} [options.region] - Optional sub-rectangle
   *        of virtual (leaf-level) pixel space that this material's uv [0,1] maps onto. Lets the
   *        mesh store LOCAL uv over a small region so the interpolated varying keeps full float32
   *        precision at deep levels (the large global offset is re-added in integer space in the
   *        shader). Omitted ⇒ uv [0,1] maps to the whole texture (legacy behavior).
   * @returns {Promise<VTAttachHandle>} Handle to later pass to detach().
   */
  async attach(options = {}) {
    let {
      material,
      tileSource: providedSource,
      leaflet,
      tileSize = 256,
      gridSize = 32,
      virtualResolution = 262144,
      pinnedLevels = 2,
      maxLoadsPerFrame = 8,
      anisotropy = 1,
      region
    } = options;

    // Clamp anisotropy to a sane integer range; 16 is the common HW cap.
    anisotropy = Math.max(1, Math.min(16, Math.round(anisotropy)));

    if (!material) {
      throw new Error('VirtualTextures.attach: options.material is required');
    }

    const device = this.#getDevice();
    if (!device) {
      throw new Error('VirtualTextures.attach: WebGPU device not available (WebGPU backend required)');
    }

    // Square virtual size in tiles. For IIIF this is derived from the source
    // image (see below); otherwise it follows the requested virtualResolution.
    let tilesPerAxis = Math.ceil(virtualResolution / tileSize);

    // Resolve the tile source: explicit source wins, else build from leaflet.
    let tileSource = providedSource;
    if (!tileSource) {
      if (!leaflet || !leaflet.baseUrl) {
        throw new Error('VirtualTextures.attach: provide options.tileSource or options.leaflet.baseUrl');
      }
      tileSource = new _tilesources_LeafletTileSource_js__WEBPACK_IMPORTED_MODULE_1__.LeafletTileSource({
        device,
        baseUrl: leaflet.baseUrl,
        urlTemplate: leaflet.urlTemplate,
        tileSize,
        maxLevel: leaflet.maxLevel ?? Math.ceil(Math.log2(tilesPerAxis)),
        width: leaflet.width ?? virtualResolution,
        height: leaflet.height ?? virtualResolution,
        cacheBucket: leaflet.cacheBucket
      });
    }

    // Reject out-of-range/degenerate regions early so the shader never addresses
    // tiles outside the pyramid. Undefined region ⇒ whole texture (no constraint).
    // The virtual texture is always square here (tilesPerAxis on both axes), so a
    // single fullPx bounds both X and Y; split to fullPxX/fullPxY if non-square
    // virtual textures are ever supported.
    if (region) {
      const fullPx = tilesPerAxis * tileSize;
      const { x, y, w, h } = region;
      const ints = [x, y, w, h].every((v) => Number.isInteger(v));
      if (!ints || w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > fullPx || y + h > fullPx) {
        throw new Error(`VirtualTextures.attach: invalid region ${JSON.stringify(region)} for ${fullPx}x${fullPx}px virtual space (need integer x,y>=0, w,h>0, x+w<=${fullPx}, y+h<=${fullPx})`);
      }
    }

    // Create and prime the cache.
    const cache = new _core_VirtualTextureCache_js__WEBPACK_IMPORTED_MODULE_0__.VirtualTextureCache(device, tileSize, gridSize, tilesPerAxis, tilesPerAxis, pinnedLevels, anisotropy, region);
    cache.setTileSource(tileSource);
    await cache.loadPinnedLevels();

    // Wire the cache into the material via the CustomSampledTexture interface.
    material.customSampledTextures = { ...(material.customSampledTextures || {}), diffuse: new _core_VirtualTexture_js__WEBPACK_IMPORTED_MODULE_2__.VirtualTexture(cache) };
    // Adding a custom sampled texture changes the pipeline (hasCustomTexture bit),
    // so force the material's pipeline hash to be recomputed, and rebuild any
    // render bundles that captured the pre-VT pipeline.
    material.needsUpdate = true;
    this.viewer.impl.glrenderer().invalidateRenderBundles();

    // Auto-refine loop: each presented frame, sample feedback and request the
    // tiles the GPU reported as visible; redraw whenever new tiles arrive.
    const loop = new _core_TileFeedbackLoop_js__WEBPACK_IMPORTED_MODULE_3__.TileFeedbackLoop(this.viewer, cache, device, { maxLoadsPerFrame });
    loop.start();

    /** @type {VTAttachHandle} */
    const handle = { cache, material, tileSource, _loop: loop };
    this.#handles.push(handle);

    this.viewer.impl.invalidate(true, true, true);
    return handle;
  }

  /**
   * Reverse attach(): stop the streaming loop, remove the material binding, and
   * release GPU resources created by this attachment.
   * @param {VTAttachHandle} handle - Handle returned by attach().
   */
  detach(handle) {
    if (!handle) {
      return;
    }
    const idx = this.#handles.indexOf(handle);
    if (idx < 0) {
      return;
    }
    this.#handles.splice(idx, 1);

    handle._loop?.stop();

    if (handle.material?.customSampledTextures) {
      delete handle.material.customSampledTextures.diffuse;
      if (Object.keys(handle.material.customSampledTextures).length === 0) {
        delete handle.material.customSampledTextures;
      }
      // Removing the custom sampled texture changes the pipeline (hasCustomTexture
      // bit), so force the pipeline hash to be recomputed (mirrors attach()).
      handle.material.needsUpdate = true;
    }

    handle.tileSource?.destroy?.();
    handle.cache?.destroy();

    this.viewer.impl.glrenderer?.()?.invalidateRenderBundles?.();
    this.viewer.impl.invalidate(true, true, true);
  }

  /**
   * Activates the virtual texture system.
   * @returns {boolean} True if activation succeeded.
   */
  activate() {
    if (this.activeStatus === true) {
      return true;
    }

    this.activeStatus = true;
    return true;
  }

  /**
   * Deactivates the virtual texture system.
   * @returns {boolean} True if deactivation succeeded.
   */
  deactivate() {
    if (this.activeStatus === false) {
      return true;
    }

    this.activeStatus = false;
    return true;
  }
}

Autodesk.Viewing.theExtensionManager.registerExtension(
  'Autodesk.VirtualTextures',
  VirtualTextures
);
})();

Autodesk.Extensions.VirtualTextures = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=VirtualTextures.js.map