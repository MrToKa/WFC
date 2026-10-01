import type { TrefoilClamp } from './trefoilClamps';

type ClampFormation = {
  widthPx: number;
  positions: Array<{ left: number; bottomOffset: number; diameterMm: number }>;
};

export const getTrefoilClampBaseHeightMm = (
  clamp: TrefoilClamp,
  formationHeightMm: number,
): number =>
  Math.max(6, Math.min(clamp.heightMm * 0.18, (clamp.heightMm - formationHeightMm) * 0.4, 22));

/** Front elevation traced from the supplied Vulcan+ DS03E drawing.
 * The reference's three cable circles and dimension annotations are omitted:
 * the tray renderer supplies the actual cables and their schedule numbers.
 */
export const drawTrefoilClamp = (
  ctx: CanvasRenderingContext2D,
  clamp: TrefoilClamp,
  formation: ClampFormation,
  left: number,
  bottom: number,
  scale: number,
) => {
  const height = clamp.heightMm * scale;
  const top = bottom - height;
  const cableHeight = Math.max(
    ...formation.positions.map(({ diameterMm, bottomOffset }) => diameterMm * scale - bottomOffset),
  );
  const footHeight = getTrefoilClampBaseHeightMm(clamp, cableHeight / scale) * scale;
  const cableBottom = height - footHeight;
  const cableTop = cableBottom - cableHeight;
  const closureHeight = Math.min(24 * scale, Math.max(8 * scale, cableTop - 3 * scale));
  const cableLeft = Math.min(...formation.positions.map((position) => position.left));
  const cableRight = Math.max(
    ...formation.positions.map((position) => position.left + position.diameterMm * scale),
  );
  const outlineWidth = Math.max(1, 0.35 * scale);
  // W1 reserves the catalog envelope. A smaller cable within the clamp's
  // range must not stretch the side band to fill the unused envelope.
  const bandWidth = ((cableRight - cableLeft) * 23) / 366;
  const frameLeft = Math.max(outlineWidth / 2, cableLeft - bandWidth);
  const frameRight = Math.min(formation.widthPx - outlineWidth / 2, cableRight + bandWidth);
  const cableWidthRatio = (cableRight - cableLeft) / formation.widthPx;
  const contourFit = Math.max(0, Math.min(1, (cableWidthRatio - 0.65) / 0.15));

  // Piecewise mapping retains the source drawing's bent frame and hardware,
  // while keeping the cables circular and the full envelope within W1 / H.
  const interpolate = (value: number, source: number[], target: number[]) => {
    let index = 0;
    while (index < source.length - 2 && value > source[index + 1]) index += 1;
    const fraction = (value - source[index]) / (source[index + 1] - source[index]);
    return target[index] + fraction * (target[index + 1] - target[index]);
  };
  const x = (value: number) => {
    const uniform = interpolate(
      value,
      [159, 571],
      [outlineWidth / 2, formation.widthPx - outlineWidth / 2],
    );
    const fitted = interpolate(
      value,
      [159, 182, 365, 548, 571],
      [frameLeft, cableLeft, formation.widthPx / 2, cableRight, frameRight],
    );
    // Small models have a wider frame relative to their cables. Retain the
    // reference silhouette there instead of stretching narrow edge regions.
    return left + uniform + (fitted - uniform) * contourFit;
  };
  const y = (value: number) =>
    top +
    interpolate(
      value,
      [28, 156, 191, 533, 645],
      [outlineWidth / 2, closureHeight, cableTop, cableBottom, height - outlineWidth / 2],
    );
  const m = (px: number, py: number) => ctx.moveTo(x(px), y(py));
  const l = (px: number, py: number) => ctx.lineTo(x(px), y(py));
  const c = (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number) =>
    ctx.bezierCurveTo(x(x1), y(y1), x(x2), y(y2), x(x3), y(y3));
  const q = (x1: number, y1: number, x2: number, y2: number) =>
    ctx.quadraticCurveTo(x(x1), y(y1), x(x2), y(y2));
  const path = (draw: () => void, fill: boolean | 'open' = false, detail = false) => {
    ctx.beginPath();
    draw();
    if (fill) {
      if (fill !== 'open') ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
    ctx.lineWidth = detail ? Math.max(0.7, 0.18 * scale) : outlineWidth;
    ctx.stroke();
  };

  ctx.save();
  ctx.strokeStyle = '#111111';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Outer, intermediate and inner edges of the bent stainless steel frame.
  path(() => {
    m(318, 156);
    c(318, 172, 314, 181, 302, 188);
    c(282, 202, 270, 219, 254, 246);
    l(174, 386);
    c(165, 407, 159, 429, 159, 449);
    c(159, 466, 163, 482, 169, 496);
    c(173, 526, 183, 552, 198, 575);
    l(223, 618);
    c(235, 639, 242, 645, 255, 645);
    l(475, 645);
    c(488, 645, 495, 639, 507, 618);
    l(532, 575);
    c(547, 552, 557, 526, 561, 496);
    c(567, 482, 571, 466, 571, 449);
    c(571, 429, 565, 407, 556, 386);
    l(476, 246);
    c(460, 219, 448, 202, 428, 188);
    c(416, 181, 412, 172, 412, 156);
    l(412, 34);
  }, 'open');
  path(
    () => {
      m(324, 156);
      c(324, 172, 320, 182, 310, 188);
      l(314, 195);
      c(304, 201, 289, 214, 281, 225);
      l(268, 246);
      l(187, 386);
      c(177, 408, 172, 430, 172, 449);
      c(172, 466, 175, 482, 179, 495);
      c(183, 526, 192, 552, 204, 575);
      l(230, 618);
      c(238, 634, 244, 640, 255, 640);
      l(475, 640);
      c(486, 640, 492, 634, 500, 618);
      l(526, 575);
      c(538, 552, 547, 526, 551, 495);
      c(555, 482, 558, 466, 558, 449);
      c(558, 430, 553, 408, 543, 386);
      l(462, 246);
      l(449, 225);
      c(441, 214, 426, 201, 416, 195);
      l(420, 188);
      c(410, 182, 406, 172, 406, 156);
      l(406, 36);
    },
    false,
    true,
  );
  path(() => {
    m(330, 156);
    c(330, 173, 325, 183, 319, 190);
    l(312, 195);
    l(319, 204);
    c(301, 216, 290, 228, 285, 237);
    l(200, 386);
    c(189, 408, 183, 430, 183, 449);
    c(183, 467, 187, 483, 195, 496);
    c(197, 523, 208, 552, 224, 575);
    l(249, 618);
    c(254, 627, 255, 630, 260, 630);
    l(470, 630);
    c(475, 630, 476, 627, 481, 618);
    l(506, 575);
    c(522, 552, 533, 523, 535, 496);
    c(543, 483, 547, 467, 547, 449);
    c(547, 430, 541, 408, 530, 386);
    l(445, 237);
    c(440, 228, 429, 216, 411, 204);
    l(418, 195);
    l(411, 190);
    c(405, 183, 402, 173, 402, 156);
    l(402, 34);
  });

  // Liner seams and the lower side hinges shown in the front elevation.
  path(
    () => {
      m(302, 188);
      l(316, 205);
      m(276, 232);
      l(286, 236);
      m(185, 390);
      l(195, 394);
      m(169, 496);
      l(195, 493);
    },
    false,
    true,
  );
  path(
    () => {
      m(428, 188);
      l(414, 205);
      m(454, 232);
      l(444, 236);
      m(545, 390);
      l(535, 394);
      m(535, 493);
      l(561, 496);
    },
    false,
    true,
  );
  path(() => {
    m(195, 493);
    l(198, 517);
    q(191, 522, 193, 527);
    q(193, 533, 198, 538);
    l(212, 560);
    m(217, 546);
    l(212, 546);
    l(212, 562);
    l(217, 562);
    m(535, 493);
    l(532, 517);
    q(539, 522, 537, 527);
    q(537, 533, 532, 538);
    l(518, 560);
    m(513, 546);
    l(518, 546);
    l(518, 562);
    l(513, 562);
  });

  // The dark elastomer inserts touch the real cable circles. Derive their
  // common tangents rather than stretching the reference's contact points.
  const circles = formation.positions.map(({ left: cableLeft, bottomOffset, diameterMm }) => {
    const radius = (diameterMm * scale) / 2;
    return {
      x: left + cableLeft + radius,
      y: top + cableBottom + bottomOffset - radius,
      radius,
    };
  });
  const [upper, ...lower] = [...circles].sort((a, b) => a.y - b.y);
  lower.sort((a, b) => a.x - b.x);
  ctx.beginPath();
  for (const [index, circle] of lower.entries()) {
    const dx = circle.x - upper.x;
    const dy = circle.y - upper.y;
    const distance = Math.hypot(dx, dy);
    const cosine = (upper.radius - circle.radius) / distance;
    const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
    const direction = index === 0 ? 1 : -1;
    const nx = (dx * cosine - direction * dy * sine) / distance;
    const ny = (dy * cosine + direction * dx * sine) / distance;
    ctx.moveTo(upper.x + nx * upper.radius, upper.y + ny * upper.radius);
    ctx.lineTo(circle.x + nx * circle.radius, circle.y + ny * circle.radius);

    const startAngle = index === 0 ? Math.PI : 0;
    const endAngle = startAngle + (index === 0 ? -1 : 1) * (Math.PI / 5);
    const handle = (4 / 3) * Math.tan((endAngle - startAngle) / 4) * circle.radius;
    const startX = circle.x + Math.cos(startAngle) * circle.radius;
    const startY = circle.y + Math.sin(startAngle) * circle.radius;
    const endX = circle.x + Math.cos(endAngle) * circle.radius;
    const endY = circle.y + Math.sin(endAngle) * circle.radius;
    ctx.moveTo(startX, startY);
    ctx.bezierCurveTo(
      startX - Math.sin(startAngle) * handle,
      startY + Math.cos(startAngle) * handle,
      endX + Math.sin(endAngle) * handle,
      endY - Math.cos(endAngle) * handle,
      endX,
      endY,
    );
  }
  ctx.moveTo(x(231), y(530));
  ctx.lineTo(x(500), y(530));
  ctx.lineWidth = Math.max(1.2, 0.55 * scale);
  ctx.stroke();

  // Molded foot: rounded top lip, tapered faces and flat mounting base.
  path(() => {
    m(217, 552);
    l(217, 542);
    q(217, 533, 228, 533);
    l(504, 533);
    q(515, 533, 515, 542);
    l(515, 552);
    l(482, 618);
    q(479, 629, 469, 629);
    l(261, 629);
    q(251, 629, 246, 619);
    l(217, 552);
  }, true);
  path(
    () => {
      m(219, 540);
      l(513, 540);
      m(219, 547);
      l(260, 618);
      l(469, 618);
      l(511, 547);
      m(260, 618);
      l(260, 628);
      m(469, 618);
      l(469, 628);
    },
    false,
    true,
  );

  // Horizontal captive closure bolt, protruding thread and right nut.
  path(() => {
    m(339, 69);
    l(477, 69);
    l(477, 120);
    l(339, 120);
  }, true);
  path(() => {
    m(473, 69);
    l(484, 69);
    q(486, 69, 486, 72);
    l(486, 118);
    q(486, 120, 484, 120);
    l(473, 120);
  }, true);
  path(() => {
    m(412, 50);
    l(470, 50);
    q(474, 50, 474, 56);
    l(474, 134);
    q(474, 141, 470, 141);
    l(412, 141);
  }, true);
  path(
    () => {
      m(438, 52);
      l(472, 52);
      m(438, 71);
      l(474, 71);
      m(438, 119);
      l(474, 119);
      m(438, 138);
      l(472, 138);
    },
    false,
    true,
  );
  path(() => {
    m(430, 42);
    c(424, 42, 422, 47, 422, 55);
    l(422, 134);
    c(422, 144, 425, 149, 430, 149);
    c(436, 149, 440, 142, 438, 132);
    c(434, 121, 439, 110, 438, 96);
    c(440, 82, 435, 70, 438, 60);
    c(440, 50, 436, 42, 430, 42);
  }, true);
  path(() => {
    m(402, 156);
    l(402, 34);
    q(402, 28, 407, 28);
    q(412, 28, 412, 34);
    l(412, 154);
    l(420, 184);
    l(414, 187);
    l(405, 166);
    l(402, 156);
  }, true);
  path(
    () => {
      m(408, 35);
      l(408, 158);
      m(413, 69);
      l(421, 69);
      m(413, 119);
      l(421, 119);
    },
    false,
    true,
  );

  // Left hinge block, folded closure cover and small captive pin.
  path(() => {
    m(270, 33);
    l(334, 33);
    q(340, 33, 340, 39);
    l(340, 151);
    q(340, 156, 334, 156);
    l(270, 156);
    q(264, 156, 264, 150);
    l(264, 39);
    q(264, 33, 270, 33);
  }, true);
  path(
    () => {
      m(269, 35);
      l(269, 154);
      m(294, 34);
      l(294, 155);
      m(298, 36);
      l(298, 154);
      m(265, 63);
      l(294, 63);
      m(265, 126);
      l(294, 126);
    },
    false,
    true,
  );
  path(() => {
    m(303, 34);
    l(336, 34);
    l(336, 151);
    l(302, 151);
    q(300, 151, 300, 148);
    l(300, 48);
    q(300, 38, 303, 34);
  });
  path(
    () => {
      m(312, 34);
      c(300, 44, 301, 57, 306, 71);
      l(320, 100);
      c(323, 88, 338, 58, 337, 43);
      l(331, 34);
    },
    false,
    true,
  );
  path(() => {
    m(319, 32);
    c(318, 27, 326, 27, 327, 33);
    l(327, 46);
    c(327, 53, 319, 53, 319, 46);
    l(319, 32);
  }, true);
  path(
    () => {
      m(324, 33);
      l(324, 47);
    },
    false,
    true,
  );
  ctx.restore();
};
