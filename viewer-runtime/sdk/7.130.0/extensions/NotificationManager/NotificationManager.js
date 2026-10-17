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

/***/ "./extensions/NotificationManager/NotificationManagerLocales.js"
/*!**********************************************************************!*\
  !*** ./extensions/NotificationManager/NotificationManagerLocales.js ***!
  \**********************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   locales: () => (/* binding */ locales)
/* harmony export */ });
/* harmony import */ var _res_locales_en_nobundle_NotificationManager_loc_json__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../res/locales/en/nobundle-NotificationManager.loc.json */ "./res/locales/en/nobundle-NotificationManager.loc.json");


// Only the English (source) strings are checked in so far. Non-English locale
// files (de, fr, ja, ...) need to be added here once the localization team has
// translated `res/locales/en/nobundle-NotificationManager.loc.json` — see
// extensions/SmartSection/SmartSectionLocales.js for the full per-locale
// import pattern to replicate. Until then, i18next's `fallbackLng: "en"`
// serves the English text for every other active locale.
const locales = {
  en: _res_locales_en_nobundle_NotificationManager_loc_json__WEBPACK_IMPORTED_MODULE_0__
};

/***/ },

/***/ "./extensions/NotificationManager/NotificationManagerUI.js"
/*!*****************************************************************!*\
  !*** ./extensions/NotificationManager/NotificationManagerUI.js ***!
  \*****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ NotificationManagerUI)
/* harmony export */ });
/* harmony import */ var _NotificationPopover_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./NotificationPopover.js */ "./extensions/NotificationManager/NotificationPopover.js");


const av = Autodesk.Viewing;
const avu = Autodesk.Viewing.UI;

/**
 * UI orchestrator for the NotificationManager extension. Owns the toolbar
 * button, the notification popover, the unread badge, and the snackbar
 * surface. The extension delegates every DOM/toolbar concern here and just
 * calls refresh()/refreshContent()/refreshBadge() after state changes.
 */
class NotificationManagerUI {
  constructor(viewer, extension) {
    this.viewer = viewer;
    this.extension = extension;
    this.panel = null;
    this.toolbarButton = null;
    this.toolbarGroup = null;
  }

  attach(toolbar) {
    if (this.toolbarGroup) return false;

    this.toolbarGroup = new avu.ControlGroup('notificationTools');

    // Notification bell — always visible per Weave spec; an orange badge
    // is overlaid by CSS when there are unread notifications.
    this.toolbarButton = new avu.Button('toolbar-notifications');
    this.toolbarButton.setToolTip('Notifications');
    this.toolbarButton.setIcon('notification-bell-icon');
    this.toolbarButton.onClick = () => this.togglePanel();
    this.toolbarGroup.addControl(this.toolbarButton);

    this._createPanel();

    toolbar.addControl(this.toolbarGroup);

    this.refreshBadge();
    return true;
  }

  detach() {
    if (this.panel) {
      this.panel.setVisible(false);
      this.panel.uninitialize();
      this.panel = null;
    }

    const toolbar = this.viewer.getToolbar();
    if (this.toolbarGroup && toolbar) {
      toolbar.removeControl(this.toolbarGroup.getId());
    }
    this.toolbarGroup = null;
    this.toolbarButton = null;
  }

  _createPanel() {
    if (this.panel) return;

    this.panel = new _NotificationPopover_js__WEBPACK_IMPORTED_MODULE_0__["default"](
      this.viewer.container,
      'notification-manager-panel',
      av.i18n?.translate ? av.i18n.translate('Notifications') : 'Notifications',
      () => this.toolbarButton?.container
    );
    this.panel.setExtension(this.extension);
    this.refreshContent();

    // Reflect open/close in the toolbar button state; clear unread dots
    // when the popover closes (Weave: closing the center marks all read).
    this.panel.addVisibilityListener((visible) => {
      this.toolbarButton?.setState(
        visible ? avu.Button.State.ACTIVE : avu.Button.State.INACTIVE
      );
      if (!visible) this.extension.markAllAsRead();
    });
  }

  togglePanel() {
    if (!this.panel) this._createPanel();
    this.panel.setVisible(!this.panel.isVisible());
  }

  openPanel() {
    if (this.panel && !this.panel.isVisible()) this.panel.setVisible(true);
  }

  isPanelVisible() {
    return !!this.panel?.isVisible();
  }

  hasPanel() {
    return !!this.panel;
  }

  refresh() {
    this.refreshContent();
    this.refreshBadge();
  }

  refreshContent() {
    if (!this.panel) return;
    this.panel.setNotifications(
      this.extension.getNotifications(),
      this.extension.getArchive(),
      this.extension.getSuppressed()
    );
  }

  refreshBadge() {
    if (!this.toolbarButton) return;
    const hasUnread = this.extension.getNotifications().some((n) => n.unread);
    this.toolbarButton.container?.classList.toggle('has-unread', hasUnread);
  }

  updateProgress(id, progress) {this.panel?.updateProgress(id, progress);}

  showSnackbar(text) {this.panel?.showSnackbar(text);}
  hideSnackbar() {this.panel?.hideSnackbar();}
}

/***/ },

/***/ "./extensions/NotificationManager/NotificationPopover.js"
/*!***************************************************************!*\
  !*** ./extensions/NotificationManager/NotificationPopover.js ***!
  \***************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ NotificationPopover)
/* harmony export */ });
/* harmony import */ var _NotificationManager_scss__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./NotificationManager.scss */ "./extensions/NotificationManager/NotificationManager.scss");


const av = Autodesk.Viewing;
const logger = Autodesk.Viewing.Private.logger;

// Cached locale-aware time formatter — produces e.g. "1:05 PM" in en-US,
// "13:05" in de-DE. Created once per locale; cleared on locale change so the
// next format call rebuilds against the new language.
let _timeFmt = null;
let _timeFmtLocale = null;
function _getTimeFmt() {
  const lang = av.i18n?.language || (typeof navigator !== 'undefined' ? navigator.language : undefined);
  if (!_timeFmt || _timeFmtLocale !== lang) {
    _timeFmt = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' });
    _timeFmtLocale = lang;
  }
  return _timeFmt;
}

// Convenience wrapper — gracefully degrades to the key when i18n hasn't been
// initialized (matches the rest of the LMV codebase which assumes
// av.i18n.translate is always available, but we keep the guard for tests).
function t(key, opts) {
  return av.i18n?.translate ? av.i18n.translate(key, opts) : key;
}

// Inline SVGs for the type-indicator icons shown at the left of each item.
// Sized to render at 20x20 in the panel; the currentColor fill is driven by
// the per-type color via the `.notification-icon` CSS rule.
const TYPE_ICONS = {
  info: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor"/>
        <rect x="11" y="10" width="2" height="7" fill="#fff"/>
        <rect x="11" y="6.5" width="2" height="2" fill="#fff"/>
    </svg>`,
  error: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <path d="M12 2 L22 12 L12 22 L2 12 Z" fill="currentColor"/>
        <rect x="11" y="6" width="2" height="8" fill="#fff"/>
        <rect x="11" y="16" width="2" height="2" fill="#fff"/>
    </svg>`,
  warning: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <path d="M12 3 L22 21 L2 21 Z" fill="currentColor"/>
        <rect x="11" y="9" width="2" height="6" fill="#fff"/>
        <rect x="11" y="17" width="2" height="2" fill="#fff"/>
    </svg>`,
  success: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor"/>
        <path d="M7 12.5 L10.5 16 L17 9" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`
};

const EMPTY_STATE_ICON = `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7z"/>
    <path d="M3 10h18l-2 8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8z"/>
</svg>`;

// Eye-with-slash glyph for the suppress action — universal "hide / don't show"
// affordance. Rendered inside the more-menu next to its label.
const SUPPRESS_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 3 L21 21"/>
    <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83"/>
    <path d="M9.88 5.1A10 10 0 0 1 12 5c5 0 9.3 3.1 11 7.5a11.4 11.4 0 0 1-3.34 4.28"/>
    <path d="M6.61 6.61C4.37 7.97 2.7 10.06 2 12.5 3.73 16.89 8 20 12 20c1.68 0 3.28-.37 4.7-1"/>
</svg>`;

// Three-dot overflow glyph for the per-item "more" menu.
const MORE_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.75"/>
    <circle cx="12" cy="12" r="1.75"/>
    <circle cx="19" cy="12" r="1.75"/>
</svg>`;

/**
 * Whether a notification's `progress` value asks for a bar: a 0..1 fraction (determinate) or `true`
 * (indeterminate). Values are normalized by the extension, so anything else means "no bar".
 * @param {number|boolean|null|undefined} progress
 */
function hasProgress(progress) {
  return progress === true || typeof progress === 'number';
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  const time = _getTimeFmt().format(d);

  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();

  let dayLabel;
  if (sameDay) dayLabel = t('Today');else
  if (isYesterday) dayLabel = t('Yesterday');else
  dayLabel = d.toLocaleDateString();

  return `${time} ${dayLabel}`;
}

/**
 * Notification popover — non-movable, positioned above the bell button with
 * an arrow pointing at it. Closes on outside-click and Escape.
 */
class NotificationPopover {
  constructor(viewerContainer, id, title, getAnchor) {
    this.viewerContainer = viewerContainer;
    this.id = id;
    this.title = title;
    this.getAnchor = getAnchor;
    this.notifications = [];
    this.archiveNotifications = [];
    this.suppressedNotifications = [];
    this._view = 'active';
    this.extension = null;
    this._visible = false;
    this._visibilityListeners = [];
    this._tabActiveEl = null;
    this._tabArchiveEl = null;
    this._tabSuppressedEl = null;
    this._snackbarEl = null;
    this._snackbarTextEl = null;
    // Per-item overflow menu — only one open at a time across the popover.
    this._openMenu = null;
    // Element to restore focus to once the popover closes; captured on open.
    this._previouslyFocusedElement = null;

    this._buildDOM();

    this._onDocMouseDown = (e) => {
      if (!this._visible) return;
      if (this.container.contains(e.target)) return;
      // Let clicks on the bell reach its own onClick (which toggles),
      // otherwise the bell would re-open right after we close here.
      const anchor = this.getAnchor?.();
      if (anchor?.contains(e.target)) return;
      this.setVisible(false);
    };
    this._onKeyDown = (e) => {
      if (!this._visible) return;

      if (e.key === 'Escape') {
        if (this._openMenu) {this._closeMenu();return;}
        this.setVisible(false);
        return;
      }
    };
    this._onMenuOutsideClick = (e) => {
      if (!this._openMenu) return;
      if (this._openMenu.contains(e.target)) return;
      // The more-button that owns this menu is also a safe click target;
      // its own toggle handler will run and close the menu.
      const parentItem = this._openMenu.closest('.notification-item');
      const moreBtn = parentItem?.querySelector('.notification-item-more');
      if (moreBtn?.contains(e.target)) return;
      this._closeMenu();
    };
    this._onReposition = () => this._reposition();
  }

  _buildDOM() {
    const root = document.createElement('div');
    root.id = this.id;
    root.className = 'notification-popover';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', t(this.title));
    root.style.display = 'none';

    const header = document.createElement('div');
    header.className = 'notification-popover-header';

    const titleEl = document.createElement('div');
    titleEl.className = 'notification-popover-title';
    titleEl.setAttribute('data-i18n', this.title);
    titleEl.textContent = t(this.title);
    header.appendChild(titleEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'notification-popover-close';
    closeBtn.title = t('Close');
    closeBtn.setAttribute('aria-label', t('Close'));
    closeBtn.onclick = () => this.setVisible(false);
    header.appendChild(closeBtn);

    root.appendChild(header);

    this.notificationsContainer = document.createElement('div');
    this.notificationsContainer.className = 'notifications-container docking-panel-scroll';
    root.appendChild(this.notificationsContainer);

    // Footer: tabs (Active/Archive/Ignored) + undo snackbar.
    const footer = document.createElement('div');
    footer.className = 'notification-popover-footer';

    const tabs = document.createElement('div');
    tabs.className = 'notification-popover-tabs';

    const makeTab = (view, key, selected = false) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `notification-tab${selected ? ' selected' : ''}`;
      tab.dataset.tabKey = key;
      tab.textContent = `${t(key)} (0)`;
      tab.onclick = () => this._setView(view);
      return tab;
    };
    this._tabActiveEl = makeTab('active', 'Active', true);
    this._tabArchiveEl = makeTab('archive', 'Archive');
    this._tabSuppressedEl = makeTab('suppressed', 'Ignored');
    tabs.appendChild(this._tabActiveEl);
    tabs.appendChild(this._tabArchiveEl);
    tabs.appendChild(this._tabSuppressedEl);

    footer.appendChild(tabs);

    const snackbar = document.createElement('div');
    snackbar.className = 'notification-popover-snackbar';

    const snackbarText = document.createElement('span');
    snackbarText.className = 'snackbar-text';
    snackbar.appendChild(snackbarText);

    const snackbarUndo = document.createElement('button');
    snackbarUndo.type = 'button';
    snackbarUndo.className = 'snackbar-undo';
    snackbarUndo.setAttribute('data-i18n', 'Undo');
    snackbarUndo.textContent = t('Undo');
    snackbarUndo.onclick = () => this.extension?._applyPendingUndo?.();
    snackbar.appendChild(snackbarUndo);

    footer.appendChild(snackbar);
    root.appendChild(footer);

    this._snackbarEl = snackbar;
    this._snackbarTextEl = snackbarText;

    const arrow = document.createElement('div');
    arrow.className = 'notification-popover-arrow';
    root.appendChild(arrow);
    this.arrow = arrow;

    this.viewerContainer.appendChild(root);
    this.container = root;

    this.updateNotifications();
  }

  updateNotifications() {
    if (!this.notificationsContainer) return;
    // Any re-render wipes the items' DOM, so stale menu references must be
    // cleared first to avoid dangling detached nodes.
    this._closeMenu();

    this.notificationsContainer.innerHTML = '';

    let items;
    if (this._view === 'archive') items = this.archiveNotifications;else
    if (this._view === 'suppressed') items = this.suppressedNotifications;else
    items = this.notifications;

    if (items.length === 0) {
      this.notificationsContainer.appendChild(this.createEmptyState());
      return;
    }

    items.forEach((notification) => {
      const notificationItem = this.createNotificationItem(notification);
      this.notificationsContainer.appendChild(notificationItem);
    });
  }

  _updateTabLabels() {
    const setLabel = (el, count) => {
      if (!el) return;
      el.textContent = `${t(el.dataset.tabKey)} (${count})`;
    };
    setLabel(this._tabActiveEl, this.notifications.length);
    setLabel(this._tabArchiveEl, this.archiveNotifications.length);
    setLabel(this._tabSuppressedEl, this.suppressedNotifications.length);
  }

  _setView(view) {
    if (this._view === view) return;
    this._view = view;
    this._tabActiveEl?.classList.toggle('selected', view === 'active');
    this._tabArchiveEl?.classList.toggle('selected', view === 'archive');
    this._tabSuppressedEl?.classList.toggle('selected', view === 'suppressed');
    this.updateNotifications();
    // Switching tabs counts as a user interaction — finalize any pending
    // undo so the snackbar doesn't linger across view changes.
    this.extension?._cancelPendingUndo?.();
  }

  setExtension(extension) {
    this.extension = extension;
  }

  showSnackbar(text) {
    if (!this._snackbarEl) return;
    if (this._snackbarTextEl) this._snackbarTextEl.textContent = text;
    this._snackbarEl.classList.add('snackbar-visible');
  }

  hideSnackbar() {
    this._snackbarEl?.classList.remove('snackbar-visible');
  }

  _toggleMenu(menu) {
    if (this._openMenu === menu) {
      this._closeMenu();
      return;
    }
    this._closeMenu();
    menu.classList.add('open');
    this._openMenu = menu;
    // Defer binding so the same click that opened the menu doesn't
    // immediately land in the outside-click handler and close it again.
    setTimeout(() => {
      if (!this._openMenu) return;
      document.addEventListener('mousedown', this._onMenuOutsideClick, true);
    }, 0);
  }

  _closeMenu() {
    if (!this._openMenu) return;
    this._openMenu.classList.remove('open');
    this._openMenu = null;
    document.removeEventListener('mousedown', this._onMenuOutsideClick, true);
  }

  createEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'notification-empty-state';

    const icon = document.createElement('div');
    icon.className = 'notification-empty-icon';
    icon.innerHTML = EMPTY_STATE_ICON;
    empty.appendChild(icon);

    const titleKey = "You've reached the end of your feed.";
    const title = document.createElement('div');
    title.className = 'notification-empty-title';
    title.setAttribute('data-i18n', titleKey);
    title.textContent = t(titleKey);
    empty.appendChild(title);

    const subtitleKey = 'Check back later for more notifications.';
    const subtitle = document.createElement('div');
    subtitle.className = 'notification-empty-subtitle';
    subtitle.setAttribute('data-i18n', subtitleKey);
    subtitle.textContent = t(subtitleKey);
    empty.appendChild(subtitle);

    return empty;
  }

  createNotificationItem(notification) {
    const isArchive = this._view === 'archive';
    const isSuppressed = this._view === 'suppressed';
    // 'suppressed' reuses the dimmed "archived" styling — they share the
    // same visual treatment (muted colorbar/icon, grey tone, no unread dot).
    const isInactive = isArchive || isSuppressed;
    const type = notification.type in TYPE_ICONS ? notification.type : 'info';

    const item = document.createElement('div');
    item.className = `notification-item type-${type}`;
    if (isInactive) item.classList.add('notification-item-archived');
    item.setAttribute('data-notification-id', notification.id);
    // Any click inside an item counts as interaction: clears the unread
    // dot, and finalizes any pending undo belonging to a *different*
    // notification. A click on the same item that just initiated the undo
    // (dismiss/suppress button) must NOT cancel its own fresh snackbar.
    item.addEventListener('click', () => {
      if (!isInactive) this.extension?._markAsRead?.(notification.id);
      const pending = this.extension?._pendingUndo;
      if (pending && pending.id !== notification.id) {
        this.extension?._cancelPendingUndo?.();
      }
    });

    // Content wrapper: icon + content-right (per Weave notification-cell spec).
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'notification-content-wrapper';
    item.appendChild(contentWrapper);

    // Type icon
    const icon = document.createElement('div');
    icon.className = 'notification-icon';
    icon.innerHTML = TYPE_ICONS[type];
    contentWrapper.appendChild(icon);

    // Content column
    const content = document.createElement('div');
    content.className = 'notification-content';

    // Title + message rendered inline: bold title followed by regular message.
    const body = document.createElement('div');
    body.className = 'notification-body';
    if (notification.title) {
      const title = document.createElement('strong');
      title.className = 'notification-title';
      title.textContent = notification.title;
      body.appendChild(title);
      if (notification.message) body.appendChild(document.createTextNode(' '));
    }
    if (notification.message) {
      body.appendChild(document.createTextNode(notification.message));
    }
    content.appendChild(body);

    // Optional progress bar, between message and actions. Active view only: Archive/Ignored rows are
    // historical records, and a bar there (an animated one especially) would read as still running.
    if (!isInactive && hasProgress(notification.progress)) {
      content.appendChild(this.createProgressBar(notification.progress));
    }

    // Action links. Archive shows Restore, Ignored shows Show again,
    // Active shows the configured action + optional labeled dismiss.
    const actions = document.createElement('div');
    actions.className = 'notification-actions';

    if (isArchive) {
      const restoreLink = document.createElement('button');
      restoreLink.type = 'button';
      restoreLink.className = 'notification-action-link notification-restore-link';
      restoreLink.setAttribute('data-i18n', 'Restore');
      restoreLink.textContent = t('Restore');
      restoreLink.title = t('Restore notification');
      restoreLink.onclick = () => this.extension?.restoreFromArchive?.(notification.id);
      actions.appendChild(restoreLink);
    } else if (isSuppressed) {
      const unsuppressLink = document.createElement('button');
      unsuppressLink.type = 'button';
      unsuppressLink.className = 'notification-action-link notification-restore-link';
      unsuppressLink.setAttribute('data-i18n', 'Show again');
      unsuppressLink.textContent = t('Show again');
      unsuppressLink.title = t('Stop ignoring this notification');
      unsuppressLink.onclick = () => this.extension?.unsuppressNotification?.(notification.id);
      actions.appendChild(unsuppressLink);
    } else {
      if (notification.action?.callback) {
        const actionLink = document.createElement('button');
        actionLink.type = 'button';
        actionLink.className = 'notification-action-link';
        actionLink.textContent = notification.action.label;
        actionLink.title = notification.action.label;
        actionLink.onclick = () => notification.action.callback();
        actions.appendChild(actionLink);
      }

      if (notification.dismissAction?.label) {
        const dismissLink = document.createElement('button');
        dismissLink.type = 'button';
        dismissLink.className = 'notification-action-link';
        dismissLink.textContent = notification.dismissAction.label;
        dismissLink.title = notification.dismissAction.label;
        dismissLink.onclick = () => notification.dismissAction.callback();
        actions.appendChild(dismissLink);
      }
    }

    if (actions.children.length > 0) content.appendChild(actions);

    // Meta row: unread dot + timestamp. Dot is only rendered while the
    // notification is unread — it clears when the user closes the panel
    // or interacts with this notification (see markAllAsRead / _markAsRead).
    const meta = document.createElement('div');
    meta.className = 'notification-meta';
    if (notification.unread) {
      const dot = document.createElement('span');
      dot.className = 'notification-status-dot';
      meta.appendChild(dot);
    }
    const time = document.createElement('span');
    time.className = 'notification-timestamp';
    time.textContent = formatTimestamp(notification.timestamp ?? Date.now());
    meta.appendChild(time);
    content.appendChild(meta);

    contentWrapper.appendChild(content);

    // Close wrapper + per-item controls (top-right): optional overflow menu
    // then the × dismiss button. Omitted entirely in archive/suppressed modes
    // (those are read-only inactive lists with their own single action link).
    if (!isInactive) {
      const closeWrapper = document.createElement('div');
      closeWrapper.className = 'notification-close-wrapper';

      // Collect up-to-two actions that live inside the "more" menu. The
      // menu is only rendered if at least one action is present — this
      // keeps single-action items (dismiss-only) from growing a useless
      // overflow button.
      const menuActions = [];
      if (notification.suppressAction) {
        menuActions.push({
          labelKey: "Don't show again",
          icon: SUPPRESS_ICON,
          callback: () => notification.suppressAction?.callback?.()
        });
      }

      if (menuActions.length > 0) {
        const menu = document.createElement('div');
        menu.className = 'notification-item-menu';
        menu.setAttribute('role', 'menu');
        for (const a of menuActions) {
          const mi = document.createElement('button');
          mi.type = 'button';
          mi.className = 'notification-menu-item';
          mi.setAttribute('role', 'menuitem');
          const iconSpan = document.createElement('span');
          iconSpan.className = 'notification-menu-item-icon';
          iconSpan.innerHTML = a.icon;
          mi.appendChild(iconSpan);
          const labelSpan = document.createElement('span');
          labelSpan.className = 'notification-menu-item-label';
          labelSpan.setAttribute('data-i18n', a.labelKey);
          labelSpan.textContent = t(a.labelKey);
          mi.appendChild(labelSpan);
          mi.onclick = (e) => {
            e.stopPropagation();
            this._closeMenu();
            a.callback();
          };
          menu.appendChild(mi);
        }

        const moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.className = 'notification-item-more';
        moreBtn.setAttribute('aria-label', t('More options'));
        moreBtn.title = t('More options');
        moreBtn.innerHTML = MORE_ICON;
        moreBtn.onclick = (e) => {
          e.stopPropagation();
          this._toggleMenu(menu);
        };

        closeWrapper.appendChild(moreBtn);
        item.appendChild(menu);
      }

      const dismissIconBtn = document.createElement('button');
      dismissIconBtn.type = 'button';
      dismissIconBtn.className = 'notification-item-close';
      dismissIconBtn.setAttribute('aria-label', t('Dismiss notification'));
      dismissIconBtn.title = t('Dismiss');
      dismissIconBtn.onclick = (e) => {
        // Dismissing re-renders the list synchronously (this item's DOM node included), so
        // stop the click from bubbling into this now-stale item's own click handler below.
        e.stopPropagation();
        notification.dismissAction?.callback?.();
      };
      closeWrapper.appendChild(dismissIconBtn);
      item.appendChild(closeWrapper);
    }

    return item;
  }

  /**
   * Progress bar for one item — a track plus a fill, sitting between the message and the action links.
   * The fill is tinted by the item's status color (see the per-type `@each` in the SCSS).
   * @param {number|boolean} progress - 0..1 fraction, or `true` for indeterminate.
   */
  createProgressBar(progress) {
    const bar = document.createElement('div');
    bar.className = 'notification-progress';
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');

    const fill = document.createElement('div');
    fill.className = 'notification-progress-fill';
    bar.appendChild(fill);

    this._applyProgress(bar, progress);
    return bar;
  }

  /**
   * Push a value into an existing bar. Indeterminate bars deliberately carry no `aria-valuenow` —
   * an absent value is what tells assistive tech the progress is unknown — and let CSS animate the fill.
   * @param {HTMLElement} bar @param {number|boolean} progress
   */
  _applyProgress(bar, progress) {
    const indeterminate = progress === true;
    bar.classList.toggle('notification-progress-indeterminate', indeterminate);

    const fill = bar.firstElementChild;
    if (indeterminate) {
      bar.removeAttribute('aria-valuenow');
      if (fill) fill.style.width = '';
      return;
    }

    const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
    bar.setAttribute('aria-valuenow', String(percent));
    if (fill) fill.style.width = `${percent}%`;
  }

  /**
   * Update one notification's bar in place, without rebuilding the list — a fast progress ticker would
   * otherwise re-render the cells under the user, dropping an open overflow menu and their scroll
   * position. A bar appearing or disappearing does change the cell layout, so that case falls back to a
   * full re-render. No-op when the id isn't rendered in the current view; the extension has already
   * stored the value, so the next render of that view picks it up.
   * @param {string} id @param {number|boolean|null} progress
   */
  updateProgress(id, progress) {
    const item = this._findItemElement(id);
    if (!item) return;

    const bar = item.querySelector('.notification-progress');
    if (!!bar !== hasProgress(progress)) {
      this.updateNotifications();
      return;
    }
    if (bar) this._applyProgress(bar, progress);
  }

  _findItemElement(id) {
    for (const el of this.notificationsContainer.querySelectorAll('.notification-item')) {
      if (el.getAttribute('data-notification-id') === id) return el;
    }
    return null;
  }

  setNotifications(active, archive = [], suppressed = []) {
    this.notifications = active;
    this.archiveNotifications = archive;
    this.suppressedNotifications = suppressed;
    this._updateTabLabels();
    this.updateNotifications();
  }

  isVisible() {return this._visible;}

  addVisibilityListener(cb) {this._visibilityListeners.push(cb);}

  setVisible(visible) {
    if (this._visible === visible) return;
    this._visible = visible;
    this.container.style.display = visible ? '' : 'none';

    if (visible) {
      this._reposition();
      // Use capture so we catch the click before it can bubble to
      // handlers that might try to stopPropagation.
      document.addEventListener('mousedown', this._onDocMouseDown, true);
      document.addEventListener('keydown', this._onKeyDown);
      window.addEventListener('resize', this._onReposition);
      // Move focus into the dialog per the WAI-ARIA dialog pattern, and remember what had
      // focus so it can be restored once the popover closes (typically the toolbar bell).
      // Lands on the currently-selected tab rather than the close button, since that's
      // where a keyboard user actually wants to start interacting with content.
      this._previouslyFocusedElement = document.activeElement;
      const selectedTab = {
        active: this._tabActiveEl,
        archive: this._tabArchiveEl,
        suppressed: this._tabSuppressedEl
      }[this._view];
      selectedTab?.focus();
    } else {
      document.removeEventListener('mousedown', this._onDocMouseDown, true);
      document.removeEventListener('keydown', this._onKeyDown);
      window.removeEventListener('resize', this._onReposition);
      // Closing the popover cancels any in-flight undo — snackbar state
      // is transient to popover visibility. Archived items stay archived.
      this.extension?._cancelPendingUndo?.();
      this._closeMenu();

      if (this._previouslyFocusedElement?.isConnected) this._previouslyFocusedElement.focus();
      this._previouslyFocusedElement = null;
    }

    // Snapshot to tolerate listeners that unsubscribe during dispatch, and
    // isolate each listener so a thrown error doesn't strand the popover
    // half-toggled or starve the rest of the listener list.
    for (const cb of [...this._visibilityListeners]) {
      try {
        cb(visible);
      } catch (err) {
        logger.warn('Notification popover visibility listener threw:', err);
      }
    }
  }

  _reposition() {
    const anchor = this.getAnchor?.();
    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
    const containerRect = this.viewerContainer.getBoundingClientRect();
    const popW = this.container.offsetWidth || 400;

    const anchorCenterX = anchorRect.left + anchorRect.width / 2 - containerRect.left;
    const gap = 12;
    // Right-aligned nub per Weave spec — the bell lives on the right side
    // of the toolbar, and the popover extends left from it with the arrow
    // pointing down at the bell from the popover's right edge.
    const arrowOffsetFromRight = 32;

    // Place popover so the arrow (positioned arrowOffsetFromRight from the
    // right edge) tips down over the anchor's center.
    let left = anchorCenterX - (popW - arrowOffsetFromRight);
    const maxLeft = Math.max(8, containerRect.width - popW - 8);
    left = Math.max(8, Math.min(left, maxLeft));

    const bottom = containerRect.height - (anchorRect.top - containerRect.top) + gap;

    this.container.style.left = `${left}px`;
    this.container.style.right = 'auto';
    this.container.style.bottom = `${bottom}px`;
    this.container.style.top = 'auto';

    // Arrow is right-aligned on the popover; if clamping pulled the popover
    // away from the bell, the tip may not land dead-center on the anchor,
    // but preserving the visual alignment to the side is preferred.
    this.arrow.style.left = `${popW - arrowOffsetFromRight}px`;
  }

  uninitialize() {
    this.setVisible(false);
    this.container?.parentNode?.removeChild(this.container);
    this.container = null;
  }
}

/***/ },

/***/ "./src/application/PrivateEventTypes.js"
/*!**********************************************!*\
  !*** ./src/application/PrivateEventTypes.js ***!
  \**********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   MODEL_CONSOLIDATION_DISABLED: () => (/* binding */ MODEL_CONSOLIDATION_DISABLED),
/* harmony export */   MODEL_CONSOLIDATION_ENABLED: () => (/* binding */ MODEL_CONSOLIDATION_ENABLED),
/* harmony export */   NOTIFICATION_EVENT: () => (/* binding */ NOTIFICATION_EVENT)
/* harmony export */ });
/**
 * This file exports events, which are not part of the public API and will not be included in the global namespace
 */


/**
 * Fired if consolidation is enabled for the model.
 * @private
 */
const MODEL_CONSOLIDATION_ENABLED = 'consolidationEnabled';

/**
 * Fired if consolidation is disabled for the model.
 * @private
 */
const MODEL_CONSOLIDATION_DISABLED = 'consolidationDisabled';

/**
 * Fired internally when core LMV wants to surface a user-facing notification.
 * The NotificationManager extension listens and presents the notification when loaded.
 * External callers should use {@link Autodesk.NotificationManager} instead.
 * @private
 */
const NOTIFICATION_EVENT = 'notification';

/***/ },

/***/ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/NotificationManager/NotificationManager.scss"
/*!*****************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/NotificationManager/NotificationManager.scss ***!
  \*****************************************************************************************************************************************************************************************************************************************************************************/
(module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../../node_modules/css-loader/dist/runtime/noSourceMaps.js */ "./node_modules/css-loader/dist/runtime/noSourceMaps.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../../node_modules/css-loader/dist/runtime/api.js */ "./node_modules/css-loader/dist/runtime/api.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../../node_modules/css-loader/dist/runtime/getUrl.js */ "./node_modules/css-loader/dist/runtime/getUrl.js");
/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__);
// Imports



var ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27black%27><path d=%27M12 2a2 2 0 0 0-2 2v.7C7.2 5.5 5 8 5 11v5l-1.4 1.4A1 1 0 0 0 4.3 19h15.4a1 1 0 0 0 .7-1.7L19 16v-5c0-3-2.2-5.5-5-6.3V4a2 2 0 0 0-2-2zm0 20a2 2 0 0 0 1.9-1.3h-3.8A2 2 0 0 0 12 22z%27/></svg> */ "data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27black%27><path d=%27M12 2a2 2 0 0 0-2 2v.7C7.2 5.5 5 8 5 11v5l-1.4 1.4A1 1 0 0 0 4.3 19h15.4a1 1 0 0 0 .7-1.7L19 16v-5c0-3-2.2-5.5-5-6.3V4a2 2 0 0 0-2-2zm0 20a2 2 0 0 0 1.9-1.3h-3.8A2 2 0 0 0 12 22z%27/></svg>"), __webpack_require__.b);
var ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));
var ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);
// Module
___CSS_LOADER_EXPORT___.push([module.id, `.notification-popover .notification-popover-snackbar .snackbar-undo, .notification-popover .notification-tab, .notification-popover .notification-menu-item, .notification-popover .notification-item-close,
.notification-popover .notification-item-more, .notification-popover .notification-action-link, .notification-popover .notification-popover-close {
  background: transparent;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.notification-popover .notification-popover-snackbar .snackbar-undo:focus, .notification-popover .notification-tab:focus, .notification-popover .notification-menu-item:focus, .notification-popover .notification-item-close:focus,
.notification-popover .notification-item-more:focus, .notification-popover .notification-action-link:focus, .notification-popover .notification-popover-close:focus {
  outline: none;
}
.notification-popover .notification-popover-snackbar .snackbar-undo:focus-visible, .notification-popover .notification-tab:focus-visible, .notification-popover .notification-menu-item:focus-visible, .notification-popover .notification-item-close:focus-visible,
.notification-popover .notification-item-more:focus-visible, .notification-popover .notification-action-link:focus-visible, .notification-popover .notification-popover-close:focus-visible {
  outline: 2px solid currentcolor;
  outline-offset: 2px;
}

.notification-popover .notification-tab, .notification-popover .notification-item-close,
.notification-popover .notification-item-more, .notification-popover .notification-popover-close {
  color: inherit;
  opacity: 0.7;
}
.notification-popover .notification-tab:hover, .notification-popover .notification-item-close:hover,
.notification-popover .notification-item-more:hover, .notification-popover .notification-popover-close:hover, .notification-popover .notification-tab:focus-visible, .notification-popover .notification-item-close:focus-visible,
.notification-popover .notification-item-more:focus-visible, .notification-popover .notification-popover-close:focus-visible {
  opacity: 1;
  background: rgba(128, 128, 128, 0.15);
}

.notification-popover .notification-item-close, .notification-popover .notification-popover-close {
  font-size: 28px;
  font-weight: 300;
  line-height: 1;
}
.notification-popover .notification-item-close::before, .notification-popover .notification-popover-close::before {
  content: "×";
}

.notification-popover {
  position: absolute;
  z-index: 100;
  display: flex;
  flex-direction: column;
  width: 400px;
  overflow: visible;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
}
.notification-popover .notification-popover-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  padding: 12px 8px 12px 16px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}
.notification-popover .notification-popover-title {
  flex: 1;
  font-size: 14px;
  font-weight: bold;
}
.notification-popover .notification-popover-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 4px;
}
.notification-popover .notification-popover-arrow {
  position: absolute;
  bottom: -7px;
  width: 14px;
  height: 14px;
  background: inherit;
  border-right: 1px solid rgba(128, 128, 128, 0.25);
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  transform: translateX(-50%) rotate(45deg);
}

.adsk-viewing-viewer.dark-theme .notification-popover {
  background-color: rgb(34, 34, 34);
  color: #fff;
}
.adsk-viewing-viewer.dark-theme .notification-popover .notification-action-link {
  color: #38abdf;
}
.adsk-viewing-viewer.dark-theme .notification-popover .notification-action-link:hover {
  color: #5fbfe8;
}
.adsk-viewing-viewer.dark-theme .notification-popover .notification-tab.selected {
  border-bottom-color: #38abdf;
}
.adsk-viewing-viewer.dark-theme .notification-popover .notification-popover-snackbar {
  background-color: rgba(255, 255, 255, 0.08);
}
.adsk-viewing-viewer.dark-theme .notification-popover .notification-item-menu {
  background-color: #2c2c2c;
  color: #fff;
}

.adsk-viewing-viewer.light-theme .notification-popover {
  background-color: #fff;
  color: #3c3c3c;
}
.adsk-viewing-viewer.light-theme .notification-popover .notification-action-link {
  color: #006eaf;
}
.adsk-viewing-viewer.light-theme .notification-popover .notification-action-link:hover {
  color: #004f7e;
}
.adsk-viewing-viewer.light-theme .notification-popover .notification-tab.selected {
  border-bottom-color: #006eaf;
}
.adsk-viewing-viewer.light-theme .notification-popover .notification-popover-snackbar {
  background-color: rgba(0, 0, 0, 0.05);
}
.adsk-viewing-viewer.light-theme .notification-popover .notification-item-menu {
  background-color: #fff;
  color: #3c3c3c;
}

.notification-popover .notifications-container {
  max-height: 492px;
  padding: 0;
}
.notification-popover .notification-item {
  position: relative;
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  border-left: 4px solid transparent;
  cursor: pointer;
}
.notification-popover .notification-item:hover {
  background: rgba(128, 128, 128, 0.15);
}
.notification-popover .notification-item:last-child {
  border-bottom: none;
}
.notification-popover .notification-item.type-info {
  border-left-color: #0696d7;
}
.notification-popover .notification-item.type-info .notification-icon {
  color: #0696d7;
}
.notification-popover .notification-item.type-info .notification-progress-fill {
  background: linear-gradient(90deg, rgba(6, 150, 215, 0.35), #0696d7);
}
.notification-popover .notification-item.type-warning {
  border-left-color: #faa21b;
}
.notification-popover .notification-item.type-warning .notification-icon {
  color: #faa21b;
}
.notification-popover .notification-item.type-warning .notification-progress-fill {
  background: linear-gradient(90deg, rgba(250, 162, 27, 0.35), #faa21b);
}
.notification-popover .notification-item.type-error {
  border-left-color: #d22;
}
.notification-popover .notification-item.type-error .notification-icon {
  color: #d22;
}
.notification-popover .notification-item.type-error .notification-progress-fill {
  background: linear-gradient(90deg, rgba(221, 34, 34, 0.35), #d22);
}
.notification-popover .notification-item.type-success {
  border-left-color: #6a9728;
}
.notification-popover .notification-item.type-success .notification-icon {
  color: #6a9728;
}
.notification-popover .notification-item.type-success .notification-progress-fill {
  background: linear-gradient(90deg, rgba(106, 151, 40, 0.35), #6a9728);
}
.notification-popover .notification-item.notification-item-archived {
  border-left-color: rgba(128, 128, 128, 0.5);
  opacity: 0.6;
}
.notification-popover .notification-item.notification-item-archived .notification-icon {
  color: rgba(128, 128, 128, 0.8);
}
.notification-popover .notification-item.notification-item-archived .notification-restore-link {
  opacity: 1;
}
.notification-popover .notification-content-wrapper {
  display: flex;
  flex: 1;
  flex-direction: row;
  gap: 12px;
  align-items: flex-start;
  min-width: 0;
  padding: 16px 0;
}
.notification-popover .notification-icon {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 24px;
}
.notification-popover .notification-icon svg {
  display: block;
  width: 24px;
  height: 24px;
}
.notification-popover .notification-content {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.notification-popover .notification-body {
  font-size: 14px;
  font-weight: 300;
  line-height: 20px;
  overflow-wrap: break-word;
}
.notification-popover .notification-body .notification-title {
  font-weight: bold;
}
.notification-popover .notification-progress {
  overflow: hidden;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(128, 128, 128, 0.15);
}
.notification-popover .notification-progress .notification-progress-fill {
  width: 0;
  height: 100%;
  border-radius: 2px;
  background: currentcolor;
  transition: width 0.2s ease-out;
}
.notification-popover .notification-progress.notification-progress-indeterminate .notification-progress-fill {
  width: 40%;
  transition: none;
  animation: notification-progress-sweep 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .notification-popover .notification-progress.notification-progress-indeterminate .notification-progress-fill {
    width: 100%;
    opacity: 0.5;
    transform: none;
    animation: none;
  }
}
.notification-popover .notification-actions {
  display: flex;
  flex-direction: row;
  gap: 24px;
  align-items: center;
  min-height: 36px;
}
.notification-popover .notification-action-link {
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  font-size: 14px;
  font-weight: bold;
  line-height: 20px;
}
.notification-popover .notification-action-link:hover {
  text-decoration: underline;
}
.notification-popover .notification-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 18px;
  font-size: 12px;
  line-height: 18px;
  opacity: 0.7;
}
.notification-popover .notification-status-dot {
  display: inline-block;
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fe8d55;
}
.notification-popover .notification-close-wrapper {
  display: flex;
  flex: none;
  flex-direction: row;
  gap: 2px;
  align-items: center;
  padding-top: 8px;
}
.notification-popover .notification-item-close,
.notification-popover .notification-item-more {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 2px;
}
.notification-popover .notification-item-close svg,
.notification-popover .notification-item-more svg {
  display: block;
}
.notification-popover .notification-item-menu {
  position: absolute;
  top: 44px;
  right: 8px;
  z-index: 10;
  display: none;
  min-width: 180px;
  padding: 4px 0;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}
.notification-popover .notification-item-menu.open {
  display: block;
}
.notification-popover .notification-menu-item {
  display: flex;
  flex-direction: row;
  gap: 10px;
  align-items: center;
  padding: 8px 12px;
  font-size: 14px;
  line-height: 20px;
  text-align: left;
}
.notification-popover .notification-menu-item:hover {
  background: rgba(128, 128, 128, 0.15);
}
.notification-popover .notification-menu-item .notification-menu-item-icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  opacity: 0.7;
}
.notification-popover .notification-menu-item .notification-menu-item-icon svg {
  display: block;
}
.notification-popover .notification-menu-item .notification-menu-item-label {
  flex: 1;
}
.notification-popover .notification-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 56px 24px;
  text-align: center;
}
.notification-popover .notification-empty-state .notification-empty-icon {
  margin-bottom: 12px;
  line-height: 0;
  opacity: 0.8;
}
.notification-popover .notification-empty-state .notification-empty-title {
  margin-bottom: 4px;
  font-size: 13px;
  font-weight: bold;
}
.notification-popover .notification-empty-state .notification-empty-subtitle {
  font-size: 12px;
  opacity: 0.7;
}
.notification-popover .notification-popover-footer {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid rgba(128, 128, 128, 0.25);
}
.notification-popover .notification-popover-tabs {
  display: flex;
  flex-direction: row;
  gap: 4px;
}
.notification-popover .notification-tab {
  padding: 6px 10px;
  border-bottom: 2px solid transparent;
  border-radius: 2px 2px 0 0;
  font-size: 14px;
  font-weight: 300;
  line-height: 20px;
}
.notification-popover .notification-tab.selected {
  font-weight: 600;
  opacity: 1;
}
.notification-popover .notification-popover-snackbar {
  display: none;
  flex-direction: row;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;
  line-height: 18px;
}
.notification-popover .notification-popover-snackbar.snackbar-visible {
  display: flex;
}
.notification-popover .notification-popover-snackbar .snackbar-text {
  flex: 1;
  min-width: 0;
}
.notification-popover .notification-popover-snackbar .snackbar-undo {
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}
.notification-popover .notification-popover-snackbar .snackbar-undo:hover {
  text-decoration: underline;
}

@keyframes notification-progress-sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
.notification-bell-icon::before {
  content: "";
  display: inline-block;
  width: 20px;
  height: 20px;
  background-color: currentcolor;
  mask: url(${___CSS_LOADER_URL_REPLACEMENT_0___}) center/contain no-repeat;
  -webkit-mask: url(${___CSS_LOADER_URL_REPLACEMENT_0___}) center/contain no-repeat;
}

#toolbar-notifications {
  position: relative;
}
#toolbar-notifications.has-unread::after {
  content: "";
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fe8d55;
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}`, ""]);
// Exports
/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (___CSS_LOADER_EXPORT___);


/***/ },

/***/ "./node_modules/css-loader/dist/runtime/api.js"
/*!*****************************************************!*\
  !*** ./node_modules/css-loader/dist/runtime/api.js ***!
  \*****************************************************/
(module) {

"use strict";


/*
  MIT License http://www.opensource.org/licenses/mit-license.php
  Author Tobias Koppers @sokra
*/
module.exports = function (cssWithMappingToString) {
  var list = [];

  // return the list of modules as css string
  list.toString = function toString() {
    return this.map(function (item) {
      var content = "";
      var needLayer = typeof item[5] !== "undefined";
      if (item[4]) {
        content += "@supports (".concat(item[4], ") {");
      }
      if (item[2]) {
        content += "@media ".concat(item[2], " {");
      }
      if (needLayer) {
        content += "@layer".concat(item[5].length > 0 ? " ".concat(item[5]) : "", " {");
      }
      content += cssWithMappingToString(item);
      if (needLayer) {
        content += "}";
      }
      if (item[2]) {
        content += "}";
      }
      if (item[4]) {
        content += "}";
      }
      return content;
    }).join("");
  };

  // import a list of modules into the list
  list.i = function i(modules, media, dedupe, supports, layer) {
    if (typeof modules === "string") {
      modules = [[null, modules, undefined]];
    }
    var alreadyImportedModules = {};
    if (dedupe) {
      for (var k = 0; k < this.length; k++) {
        var id = this[k][0];
        if (id != null) {
          alreadyImportedModules[id] = true;
        }
      }
    }
    for (var _k = 0; _k < modules.length; _k++) {
      var item = [].concat(modules[_k]);
      if (dedupe && alreadyImportedModules[item[0]]) {
        continue;
      }
      if (typeof layer !== "undefined") {
        if (typeof item[5] === "undefined") {
          item[5] = layer;
        } else {
          item[1] = "@layer".concat(item[5].length > 0 ? " ".concat(item[5]) : "", " {").concat(item[1], "}");
          item[5] = layer;
        }
      }
      if (media) {
        if (!item[2]) {
          item[2] = media;
        } else {
          item[1] = "@media ".concat(item[2], " {").concat(item[1], "}");
          item[2] = media;
        }
      }
      if (supports) {
        if (!item[4]) {
          item[4] = "".concat(supports);
        } else {
          item[1] = "@supports (".concat(item[4], ") {").concat(item[1], "}");
          item[4] = supports;
        }
      }
      list.push(item);
    }
  };
  return list;
};

/***/ },

/***/ "./node_modules/css-loader/dist/runtime/getUrl.js"
/*!********************************************************!*\
  !*** ./node_modules/css-loader/dist/runtime/getUrl.js ***!
  \********************************************************/
(module) {

"use strict";


module.exports = function (url, options) {
  if (!options) {
    options = {};
  }
  if (!url) {
    return url;
  }
  url = String(url.__esModule ? url.default : url);

  // If url is already wrapped in quotes, remove them
  if (/^['"].*['"]$/.test(url)) {
    url = url.slice(1, -1);
  }
  if (options.hash) {
    url += options.hash;
  }

  // Should url be wrapped?
  // See https://drafts.csswg.org/css-values-3/#urls
  if (/["'() \t\n]|(%20)/.test(url) || options.needQuotes) {
    return "\"".concat(url.replace(/"/g, '\\"').replace(/\n/g, "\\n"), "\"");
  }
  return url;
};

/***/ },

/***/ "./node_modules/css-loader/dist/runtime/noSourceMaps.js"
/*!**************************************************************!*\
  !*** ./node_modules/css-loader/dist/runtime/noSourceMaps.js ***!
  \**************************************************************/
(module) {

"use strict";


module.exports = function (i) {
  return i[1];
};

/***/ },

/***/ "./extensions/NotificationManager/NotificationManager.scss"
/*!*****************************************************************!*\
  !*** ./extensions/NotificationManager/NotificationManager.scss ***!
  \*****************************************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

"use strict";
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (__WEBPACK_DEFAULT_EXPORT__)
/* harmony export */ });
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js */ "./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/styleDomAPI.js */ "./node_modules/style-loader/dist/runtime/styleDomAPI.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/insertBySelector.js */ "./node_modules/style-loader/dist/runtime/insertBySelector.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js */ "./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/insertStyleElement.js */ "./node_modules/style-loader/dist/runtime/insertStyleElement.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! !../../node_modules/style-loader/dist/runtime/styleTagTransform.js */ "./node_modules/style-loader/dist/runtime/styleTagTransform.js");
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NotificationManager_scss__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../../node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!../../node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!../../node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./NotificationManager.scss */ "./node_modules/css-loader/dist/cjs.js??ruleSet[1].rules[4].use[1]!./node_modules/css-unicode-loader/index.js??ruleSet[1].rules[4].use[2]!./node_modules/sass-loader/dist/cjs.js??ruleSet[1].rules[4].use[3]!./extensions/NotificationManager/NotificationManager.scss");

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());

      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
    
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NotificationManager_scss__WEBPACK_IMPORTED_MODULE_6__["default"], options);




       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NotificationManager_scss__WEBPACK_IMPORTED_MODULE_6__["default"] && _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NotificationManager_scss__WEBPACK_IMPORTED_MODULE_6__["default"].locals ? _node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_4_use_1_node_modules_css_unicode_loader_index_js_ruleSet_1_rules_4_use_2_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_4_use_3_NotificationManager_scss__WEBPACK_IMPORTED_MODULE_6__["default"].locals : undefined);


/***/ },

/***/ "./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js"
/*!****************************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js ***!
  \****************************************************************************/
(module) {

"use strict";


var stylesInDOM = [];
function getIndexByIdentifier(identifier) {
  var result = -1;
  for (var i = 0; i < stylesInDOM.length; i++) {
    if (stylesInDOM[i].identifier === identifier) {
      result = i;
      break;
    }
  }
  return result;
}
function modulesToDom(list, options) {
  var idCountMap = {};
  var identifiers = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var id = options.base ? item[0] + options.base : item[0];
    var count = idCountMap[id] || 0;
    var identifier = "".concat(id, " ").concat(count);
    idCountMap[id] = count + 1;
    var indexByIdentifier = getIndexByIdentifier(identifier);
    var obj = {
      css: item[1],
      media: item[2],
      sourceMap: item[3],
      supports: item[4],
      layer: item[5]
    };
    if (indexByIdentifier !== -1) {
      stylesInDOM[indexByIdentifier].references++;
      stylesInDOM[indexByIdentifier].updater(obj);
    } else {
      var updater = addElementStyle(obj, options);
      options.byIndex = i;
      stylesInDOM.splice(i, 0, {
        identifier: identifier,
        updater: updater,
        references: 1
      });
    }
    identifiers.push(identifier);
  }
  return identifiers;
}
function addElementStyle(obj, options) {
  var api = options.domAPI(options);
  api.update(obj);
  var updater = function updater(newObj) {
    if (newObj) {
      if (newObj.css === obj.css && newObj.media === obj.media && newObj.sourceMap === obj.sourceMap && newObj.supports === obj.supports && newObj.layer === obj.layer) {
        return;
      }
      api.update(obj = newObj);
    } else {
      api.remove();
    }
  };
  return updater;
}
module.exports = function (list, options) {
  options = options || {};
  list = list || [];
  var lastIdentifiers = modulesToDom(list, options);
  return function update(newList) {
    newList = newList || [];
    for (var i = 0; i < lastIdentifiers.length; i++) {
      var identifier = lastIdentifiers[i];
      var index = getIndexByIdentifier(identifier);
      stylesInDOM[index].references--;
    }
    var newLastIdentifiers = modulesToDom(newList, options);
    for (var _i = 0; _i < lastIdentifiers.length; _i++) {
      var _identifier = lastIdentifiers[_i];
      var _index = getIndexByIdentifier(_identifier);
      if (stylesInDOM[_index].references === 0) {
        stylesInDOM[_index].updater();
        stylesInDOM.splice(_index, 1);
      }
    }
    lastIdentifiers = newLastIdentifiers;
  };
};

/***/ },

/***/ "./node_modules/style-loader/dist/runtime/insertBySelector.js"
/*!********************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/insertBySelector.js ***!
  \********************************************************************/
(module) {

"use strict";


var memo = {};

/* istanbul ignore next  */
function getTarget(target) {
  if (typeof memo[target] === "undefined") {
    var styleTarget = document.querySelector(target);

    // Special case to return head of iframe instead of iframe itself
    if (window.HTMLIFrameElement && styleTarget instanceof window.HTMLIFrameElement) {
      try {
        // This will throw an exception if access to iframe is blocked
        // due to cross-origin restrictions
        styleTarget = styleTarget.contentDocument.head;
      } catch (e) {
        // istanbul ignore next
        styleTarget = null;
      }
    }
    memo[target] = styleTarget;
  }
  return memo[target];
}

/* istanbul ignore next  */
function insertBySelector(insert, style) {
  var target = getTarget(insert);
  if (!target) {
    throw new Error("Couldn't find a style target. This probably means that the value for the 'insert' parameter is invalid.");
  }
  target.appendChild(style);
}
module.exports = insertBySelector;

/***/ },

/***/ "./node_modules/style-loader/dist/runtime/insertStyleElement.js"
/*!**********************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/insertStyleElement.js ***!
  \**********************************************************************/
(module) {

"use strict";


/* istanbul ignore next  */
function insertStyleElement(options) {
  var element = document.createElement("style");
  options.setAttributes(element, options.attributes);
  options.insert(element, options.options);
  return element;
}
module.exports = insertStyleElement;

/***/ },

/***/ "./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js"
/*!**********************************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js ***!
  \**********************************************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

"use strict";


/* istanbul ignore next  */
function setAttributesWithoutAttributes(styleElement) {
  var nonce =  true ? __webpack_require__.nc : 0;
  if (nonce) {
    styleElement.setAttribute("nonce", nonce);
  }
}
module.exports = setAttributesWithoutAttributes;

/***/ },

/***/ "./node_modules/style-loader/dist/runtime/styleDomAPI.js"
/*!***************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/styleDomAPI.js ***!
  \***************************************************************/
(module) {

"use strict";


/* istanbul ignore next  */
function apply(styleElement, options, obj) {
  var css = "";
  if (obj.supports) {
    css += "@supports (".concat(obj.supports, ") {");
  }
  if (obj.media) {
    css += "@media ".concat(obj.media, " {");
  }
  var needLayer = typeof obj.layer !== "undefined";
  if (needLayer) {
    css += "@layer".concat(obj.layer.length > 0 ? " ".concat(obj.layer) : "", " {");
  }
  css += obj.css;
  if (needLayer) {
    css += "}";
  }
  if (obj.media) {
    css += "}";
  }
  if (obj.supports) {
    css += "}";
  }
  var sourceMap = obj.sourceMap;
  if (sourceMap && typeof btoa !== "undefined") {
    css += "\n/*# sourceMappingURL=data:application/json;base64,".concat(btoa(unescape(encodeURIComponent(JSON.stringify(sourceMap)))), " */");
  }

  // For old IE
  /* istanbul ignore if  */
  options.styleTagTransform(css, styleElement, options.options);
}
function removeStyleElement(styleElement) {
  // istanbul ignore if
  if (styleElement.parentNode === null) {
    return false;
  }
  styleElement.parentNode.removeChild(styleElement);
}

/* istanbul ignore next  */
function domAPI(options) {
  if (typeof document === "undefined") {
    return {
      update: function update() {},
      remove: function remove() {}
    };
  }
  var styleElement = options.insertStyleElement(options);
  return {
    update: function update(obj) {
      apply(styleElement, options, obj);
    },
    remove: function remove() {
      removeStyleElement(styleElement);
    }
  };
}
module.exports = domAPI;

/***/ },

/***/ "./node_modules/style-loader/dist/runtime/styleTagTransform.js"
/*!*********************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/styleTagTransform.js ***!
  \*********************************************************************/
(module) {

"use strict";


/* istanbul ignore next  */
function styleTagTransform(css, styleElement) {
  if (styleElement.styleSheet) {
    styleElement.styleSheet.cssText = css;
  } else {
    while (styleElement.firstChild) {
      styleElement.removeChild(styleElement.firstChild);
    }
    styleElement.appendChild(document.createTextNode(css));
  }
}
module.exports = styleTagTransform;

/***/ },

/***/ "data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27black%27><path d=%27M12 2a2 2 0 0 0-2 2v.7C7.2 5.5 5 8 5 11v5l-1.4 1.4A1 1 0 0 0 4.3 19h15.4a1 1 0 0 0 .7-1.7L19 16v-5c0-3-2.2-5.5-5-6.3V4a2 2 0 0 0-2-2zm0 20a2 2 0 0 0 1.9-1.3h-3.8A2 2 0 0 0 12 22z%27/></svg>"
/*!*****************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27black%27><path d=%27M12 2a2 2 0 0 0-2 2v.7C7.2 5.5 5 8 5 11v5l-1.4 1.4A1 1 0 0 0 4.3 19h15.4a1 1 0 0 0 .7-1.7L19 16v-5c0-3-2.2-5.5-5-6.3V4a2 2 0 0 0-2-2zm0 20a2 2 0 0 0 1.9-1.3h-3.8A2 2 0 0 0 12 22z%27/></svg> ***!
  \*****************************************************************************************************************************************************************************************************************************************************************************************************************************/
(module) {

"use strict";
module.exports = "data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27 fill=%27black%27><path d=%27M12 2a2 2 0 0 0-2 2v.7C7.2 5.5 5 8 5 11v5l-1.4 1.4A1 1 0 0 0 4.3 19h15.4a1 1 0 0 0 .7-1.7L19 16v-5c0-3-2.2-5.5-5-6.3V4a2 2 0 0 0-2-2zm0 20a2 2 0 0 0 1.9-1.3h-3.8A2 2 0 0 0 12 22z%27/></svg>";

/***/ },

/***/ "./res/locales/en/nobundle-NotificationManager.loc.json"
/*!**************************************************************!*\
  !*** ./res/locales/en/nobundle-NotificationManager.loc.json ***!
  \**************************************************************/
(module) {

"use strict";
module.exports = /*#__PURE__*/JSON.parse('{"@@locale":"en","@@context":"NotificationManager extension","Notifications":"Notifications","Notification archived":"Notification archived","Notification ignored":"Notification ignored","Today":"Today","Yesterday":"Yesterday","Close":"Close","Undo":"Undo","Restore":"Restore","Restore notification":"Restore notification","Show again":"Show again","Stop ignoring this notification":"Stop ignoring this notification","More options":"More options","Dismiss notification":"Dismiss notification","Dismiss":"Dismiss","Active":"Active","Archive":"Archive","Ignored":"Ignored","Don\'t show again":"Don\'t show again"}');

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
/******/ 			id: moduleId,
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
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
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
/******/ 	/* webpack/runtime/jsonp chunk loading */
/******/ 	(() => {
/******/ 		__webpack_require__.b = (typeof document !== 'undefined' && document.baseURI) || self.location.href;
/******/ 		
/******/ 		// object to store loaded and loading chunks
/******/ 		// undefined = chunk not loaded, null = chunk preloaded/prefetched
/******/ 		// [resolve, reject, Promise] = chunk loading, 0 = chunk loaded
/******/ 		var installedChunks = {
/******/ 			"NotificationManager": 0
/******/ 		};
/******/ 		
/******/ 		// no chunk on demand loading
/******/ 		
/******/ 		// no prefetching
/******/ 		
/******/ 		// no preloaded
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 		
/******/ 		// no on chunks loaded
/******/ 		
/******/ 		// no jsonp function
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/nonce */
/******/ 	(() => {
/******/ 		__webpack_require__.nc = undefined;
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be in strict mode.
(() => {
"use strict";
/*!***************************************************************!*\
  !*** ./extensions/NotificationManager/NotificationManager.js ***!
  \***************************************************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   "default": () => (/* binding */ NotificationManagerExtension)
/* harmony export */ });
/* harmony import */ var _NotificationManagerUI_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./NotificationManagerUI.js */ "./extensions/NotificationManager/NotificationManagerUI.js");
/* harmony import */ var _NotificationManagerLocales_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./NotificationManagerLocales.js */ "./extensions/NotificationManager/NotificationManagerLocales.js");
/* harmony import */ var _src_application_PrivateEventTypes_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../../src/application/PrivateEventTypes.js */ "./src/application/PrivateEventTypes.js");




const av = Autodesk.Viewing;
const avp = av.Private;
const logger = Autodesk.Viewing.Private.logger;

/**
 * NotificationManager Extension
 *
 * Manages global user-facing notifications with an optional UI (toolbar button and notification center panel).
 * Provides API to add, manage, and dismiss notifications with custom actions.
 *
 * Extension Options:
 * - enableUI: boolean - Enable the toolbar UI (default: false)
 * - autoOpenUI: boolean - Automatically open the notification panel when a new notification is added (default: false)
 *
 * Notification Object Structure (caller-provided):
 * - id: string - Unique identifier for the notification (required)
 * - title: string - Title of the notification
 * - message: string - Message content of the notification
 * - showImmediately: boolean - Whether to open the notification panel immediately (if enableUI is true)
 * - type: string - Type of notification ('info', 'warning', 'error', 'success'). Default 'warning'; unknown values fall back to 'warning'.
 * - suppressible: boolean - Show a "Don't show again" entry in the per-item overflow menu. Default true; pass false for transient or legally-required notices.
 * - progress: number|boolean - Progress bar under the message: 0..1 fraction (determinate) or true (indeterminate). Omit for none; update via setNotificationProgress().
 * - action: object - Action button with 'label' and 'callback' function
 * - dismissAction: object - Dismiss button with 'label' (optional, omit for × icon only) and 'callback' function
 *
 * System-set fields (added by the extension; callers should not provide):
 * - timestamp: number - Dispatch time in ms since epoch.
 * - unread: boolean - Always set to true on dispatch; cleared on user interaction or panel close.
 * - suppressAction: object - Wired automatically when `suppressible` is true; renders the menu entry.
 *
 * Usage:
 * ```js
 * // Load the extension with options
 * const notificationManager = await viewer.loadExtension('Autodesk.NotificationManager', {
 *   enableUI: true // Enable the toolbar UI
 * });
 *
 * // Add a notification
 * notificationManager.dispatchNotification({
 *   id: 'my-notification',
 *   title: 'Warning',
 *   message: 'This is a warning message',
 *   type: 'warning', // 'info', 'warning', 'error', 'success'
 *   action: {
 *     label: 'Fix Issue',
 *     callback: () => console.log('Action clicked')
 *   }
 * });
 *
 * // Remove a notification
 * notificationManager.removeNotification('my-notification');
 * ```
 */

// Origin-wide key — all LMV instances on the same origin share the suppressed set.
const SUPPRESSED_STORAGE_KEY = 'adsk.lmv.notifications.suppressed';

// Recognized notification types. Unknown types are normalized to 'warning' on
// dispatch so subscriber/icon/colorbar lookups always succeed.
const VALID_TYPES = ['info', 'warning', 'error', 'success'];

/**
 * Normalize a caller's `progress` value into what the popover renders:
 * a 0..1 fraction (determinate bar, clamped), `true` (indeterminate bar for
 * work with no measurable percentage), or null (no bar). Anything else —
 * including NaN/Infinity and `false` — collapses to null rather than throwing,
 * so a bad value just costs the bar instead of the whole notification.
 * @param {number|boolean|null|undefined} progress
 * @returns {number|true|null}
 */
function normalizeProgress(progress) {
  if (progress === true) return true;
  if (typeof progress === 'number' && Number.isFinite(progress)) {
    return Math.min(1, Math.max(0, progress));
  }
  return null;
}

/**
 * NotificationManager Extension Class
 */
class NotificationManagerExtension extends av.Extension {
  constructor(viewer, options = {}) {
    super(viewer, options);

    this.name = 'NotificationManager';
    this.notifications = new Map(); // id -> notification object
    // Tracks ids that have already fired the 'dispatched' analytics event,
    // so re-dispatching the same id (e.g. to update its content) doesn't
    // inflate the count. Session-only, like the archive.
    this._dispatchedAnalyticsIds = new Set();
    // Archive keeps insertion order (chronological). Capped FIFO; session-only.
    this._archive = new Map();
    this._ARCHIVE_CAP = 50;
    // { id: string } — null when no undo is pending.
    this._pendingUndo = null;
    // ui is optional since the extension can operate in headless mode without it
    this.ui = null;
    // mark panel to open, once toolbar is ready, as a notification could already be dispatched
    this._openOnInit = false;

    this.notificationSubscribers = {
      info: [],
      warning: [],
      error: [],
      success: []
    };

    // Default options
    this.options = {
      enableUI: false,
      autoOpenUI: false,
      ...options
    };

    // id -> { id, title, message, type, timestamp } — keeps enough metadata
    // to render the suppressed list without requiring a re-dispatch.
    // Capped FIFO, like the archive, but larger since suppression is meant to persist
    // indefinitely across sessions rather than act as a short recency buffer.
    this._SUPPRESSED_CAP = 200;
    this._suppressed = this._loadSuppressed();
    if (this._evictOldestSuppressed()) this._saveSuppressed();
  }

  load() {
    super.load();

    this.extendLocalization(_NotificationManagerLocales_js__WEBPACK_IMPORTED_MODULE_1__.locales);
    this._bindViewerEvents();

    return true;
  }

  unload() {
    this._unbindViewerEvents();
    this._cancelPendingUndo();
    this.ui?.detach();
    this.notifications.clear();
    this._archive.clear();
    this._dispatchedAnalyticsIds.clear();
    return super.unload();
  }

  _bindViewerEvents() {
    this._onNotificationEvent = (event) => {
      if (event.notification) {
        this.dispatchNotification(event.notification);
      }
    };

    this.viewer.addEventListener(_src_application_PrivateEventTypes_js__WEBPACK_IMPORTED_MODULE_2__.NOTIFICATION_EVENT, this._onNotificationEvent);
  }

  _unbindViewerEvents() {
    if (!this._onNotificationEvent) return;
    this.viewer.removeEventListener(_src_application_PrivateEventTypes_js__WEBPACK_IMPORTED_MODULE_2__.NOTIFICATION_EVENT, this._onNotificationEvent);
    this._onNotificationEvent = null;
  }

  onToolbarCreated(toolbar) {
    if (!this.options.enableUI) return;
    this.ui = new _NotificationManagerUI_js__WEBPACK_IMPORTED_MODULE_0__["default"](this.viewer, this);
    this.ui.attach(toolbar);

    // Delay the initial open to give the toolbar time to render and avoid a jarring flash of the panel on startup.
    // The 2s delay is arbitrary but seems to work well in practice.
    if (this._openOnInit) {
      this._openOnInit = false;
      setTimeout(() => {
        this.ui.refresh();
        this.ui.openPanel();
      }, 2000);
    }
  }

  markAllAsRead() {
    let changed = false;
    for (const n of this.notifications.values()) {
      if (n.unread) {
        n.unread = false;
        changed = true;
      }
    }
    if (changed) this.ui?.refresh();
  }

  _markAsRead(id) {
    const n = this.notifications.get(id);
    if (n?.unread) {
      n.unread = false;
      this.ui?.refresh();
    }
  }

  /**
   * Add a new notification
   *
   * @param {Object} notification - Notification object
   * @param {string} notification.id - Unique identifier
   * @param {string} notification.title - Notification title
   * @param {string} notification.message - Notification message
   * @param {boolean} [notification.showImmediately] - Whether to open the notification panel immediately
   * @param {string} [notification.type='warning'] - Type: 'info', 'warning', 'error', 'success'. Unknown values fall back to 'warning'.
   * @param {boolean} [notification.suppressible=true] - Show a "Don't show again" button; if clicked, the id is stored in localStorage and future dispatchNotification calls for this id are silently ignored. Pass `false` to opt out (no suppress action rendered)
   * @param {number|boolean} [notification.progress] - Render a progress bar under the message: a 0..1 fraction for a determinate bar (clamped), or `true` for an indeterminate one when the duration isn't measurable. Omit for no bar. Update it in place with {@link setNotificationProgress}; re-dispatching the same id without `progress` removes the bar.
   * @param {Object} [notification.action] - Action object
   * @param {string} notification.action.label - Action button label
   * @param {Function} notification.action.callback - Action callback function
   * @param {Object} [notification.dismissAction] - Dismiss action object
   * @param {string} [notification.dismissAction.label] - Dismiss button label (omit for × icon only)
   * @param {Function} [notification.dismissAction.callback] - Dismiss callback function (defaults to removeNotification)
   */
  dispatchNotification(notification) {
    if (!notification?.id) {
      logger.error('Notification must have an id');
      return;
    }

    if (this.isSuppressed(notification.id)) {
      logger.debug('Notification suppressed:', notification.id);
      return;
    }

    // Normalize unknown notification types so the colorbar/icon/subscriber
    // lookups all hit a known bucket. Caller's `type` value is preserved
    // when valid; anything else collapses to 'warning'.
    let type = notification.type ?? 'warning';
    if (!VALID_TYPES.includes(type)) {
      logger.warn(`Unknown notification type "${type}" — falling back to "warning".`);
      type = 'warning';
    }

    // Fire once per unique id — re-dispatching the same id to update its
    // content shouldn't inflate the dispatch count.
    if (!this._dispatchedAnalyticsIds.has(notification.id)) {
      this._dispatchedAnalyticsIds.add(notification.id);
      avp.analytics.track('viewer.notifications.dispatched', { id: notification.id, type });
    }

    // Shallow copy of the caller's object: top-level keys are owned by us
    // from here on, so any wrapping/replacement of `dismissAction`,
    // `action`, etc. below mutates only this copy. Defaults come before
    // the spread so callers can override `suppressible`; system-managed
    // fields (`type` after normalization, `timestamp`, `unread`) come
    // after so they cannot be spoofed by a caller passing them in.
    const fullNotification = {
      suppressible: true,
      ...notification,
      type,
      progress: normalizeProgress(notification.progress),
      timestamp: Date.now(),
      unread: true
    };

    // Inject suppress action so the panel can render the "Don't show again" button
    if (fullNotification.suppressible) {
      fullNotification.suppressAction = {
        callback: () => this.suppressNotification(fullNotification.id)
      };
    }

    // Wrap (or default) the dismiss action so removeNotification always
    // fires alongside any caller-supplied callback. The label is preserved
    // when present so the popover can render a labelled dismiss link
    // alongside the × icon.
    const userDismissCb = fullNotification.dismissAction?.callback;
    fullNotification.dismissAction = {
      label: fullNotification.dismissAction?.label,
      callback: (...args) => {
        this.removeNotification(fullNotification.id);
        userDismissCb?.(...args);
      }
    };

    // Wrap the primary action so interacting with a notification clears
    // its unread dot (Weave: "interacts with the notification" clears unread).
    if (fullNotification.action?.callback) {
      const originalActionCb = fullNotification.action.callback;
      fullNotification.action = {
        ...fullNotification.action,
        callback: (...args) => {
          this._markAsRead(fullNotification.id);
          avp.analytics.track('viewer.notifications.action_clicked', {
            id: fullNotification.id,
            type: fullNotification.type,
            label: fullNotification.action.label
          });
          originalActionCb(...args);
        }
      };
    }

    // Remove any prior archived copy so the same id doesn't appear in both views.
    this._archive.delete(fullNotification.id);
    this.notifications.set(fullNotification.id, fullNotification);

    this.ui?.refresh();

    if (this.options.autoOpenUI || fullNotification.showImmediately) {
      if (this.ui)
      this.ui.openPanel();else

      this._openOnInit = true;
    }

    logger.debug('Notification added:', fullNotification.id);

    // Snapshot subscribers before iterating so an unsubscribe-during-fire
    // doesn't shift the live array, and isolate each callback so a thrown
    // error from one subscriber doesn't starve the rest or surface back
    // through dispatch.
    const subscribers = this.notificationSubscribers[fullNotification.type];
    if (subscribers) {
      for (const callback of [...subscribers]) {
        try {
          callback(fullNotification);
        } catch (err) {
          logger.warn('Notification subscriber threw:', err);
        }
      }
    }
  }

  /**
   * Update the progress bar of an already-dispatched notification, in place.
   *
   * Preferred over re-dispatching for progress ticks: dispatchNotification()
   * resets `timestamp` and `unread` (so a ticking bar would keep re-marking
   * the item unread and bumping its time) and rebuilds the list DOM, whereas
   * this only touches the bar. Dropping to `null` removes the bar and does
   * trigger a re-render, since that changes the cell layout.
   *
   * @param {string} id - Notification ID; must be currently active.
   * @param {number|boolean|null} progress - 0..1 fraction (clamped), `true` for indeterminate, or null to remove the bar.
   * @returns {boolean} true if an active notification was updated.
   */
  setNotificationProgress(id, progress) {
    const notification = this.notifications.get(id);
    if (!notification) return false;

    notification.progress = normalizeProgress(progress);
    this.ui?.updateProgress(id, notification.progress);
    return true;
  }

  /**
   * Removes a notification. By default the notification is moved to the
   * session archive and an "Undo" snackbar is shown in the popover footer.
   * The snackbar stays until the next user interaction (tab switch, clicking
   * another notification, or closing the popover). Pass `{ archive: false }`
   * to delete outright without archiving.
   * @param {string} id - Notification ID to remove
   * @param {Object} [opts]
   * @param {boolean} [opts.archive=true] - Move to archive instead of deleting.
   */
  removeNotification(id, opts) {
    const notification = this.notifications.get(id);
    if (!notification) return;

    avp.analytics.track('viewer.notifications.dismissed', { id, type: notification.type });

    const archive = opts?.archive !== false;
    if (archive) {
      this._archiveNotification(id);
      this._beginPendingUndo(id);
    } else {
      this.notifications.delete(id);
    }

    this.ui?.refresh();

    logger.debug('Notification removed:', id);
  }

  /**
   * Subscribe to notifications
   * @param {Array<'info'|'warning'|'error'|'success'>} types - Filter by notification type, empty array means all types
   * @param {Function} callback - Callback function to be called when a notification is added
   */
  subscribeToNotifications(types, callback) {
    if (!types || types.length === 0) {
      types = ['info', 'warning', 'error', 'success'];
    }

    for (const type of types) {
      const subs = this.notificationSubscribers[type];
      if (subs && subs.indexOf(callback) === -1) {
        subs.push(callback);
      }
    }
  }

  /**
   * Unsubscribe from notifications
   * @param {Function} callback - Callback function to be removed
   */
  unsubscribeFromNotifications(callback) {
    for (const type of Object.keys(this.notificationSubscribers)) {
      this.notificationSubscribers[type] = this.notificationSubscribers[type].filter((c) => c !== callback);
    }
  }

  /**
   * Permanently suppress a notification by id. Suppressed notifications are
   * silently ignored by dispatchNotification and persisted across sessions.
   * Captures a snapshot of the notification's visible metadata (title,
   * message, type, timestamp) so the Ignored tab can render the entry even
   * after the active item is gone.
   * @param {string} id - Notification ID to suppress
   */
  suppressNotification(id) {
    // Capture metadata for the Ignored tab before we drop the active
    // entry. If the caller suppresses an id with no active entry (e.g.
    // proactive suppression before first dispatch), fall back to the id
    // alone — the Ignored row will render with just the id.
    const source = this.notifications.get(id) || this._archive.get(id);
    const meta = source ?
    { id, title: source.title, message: source.message, type: source.type, timestamp: source.timestamp } :
    { id, timestamp: Date.now() };
    this._suppressed.set(id, meta);
    this._evictOldestSuppressed();
    this._saveSuppressed();

    avp.analytics.track('viewer.notifications.suppressed', { id, type: meta.type });

    // If the notification is currently active, archive it under a custom
    // snackbar text — "Notification ignored" reflects the suppress action,
    // and Undo will restore it _and_ lift the suppression. When there's
    // no active entry, just refresh the Ignored tab content.
    if (this.notifications.has(id)) {
      this._archiveNotification(id);
      this._beginPendingUndo(id, av.i18n.translate('Notification ignored'));
      this.ui?.refresh();
    } else {
      this.ui?.refreshContent();
    }

    logger.debug('Notification suppressed:', id);
  }

  /**
   * Remove a previously set suppression so the notification can be shown again.
   * @param {string} id - Notification ID to un-suppress
   */
  unsuppressNotification(id) {
    if (!this._suppressed.has(id)) return;
    this._suppressed.delete(id);
    this._saveSuppressed();
    this.ui?.refreshContent();
    logger.debug('Notification un-suppressed:', id);
  }

  /**
   * Remove all stored suppressions.
   */
  clearSuppressedNotifications() {
    if (this._suppressed.size === 0) return;
    this._suppressed.clear();
    this._saveSuppressed();
    this.ui?.refreshContent();
    logger.debug('All notification suppressions cleared');
  }

  /**
   * Returns true if the given notification id is currently suppressed.
   * @param {string} id
   * @returns {boolean}
   */
  isSuppressed(id) {
    return this._suppressed.has(id);
  }

  /**
   * Get all suppressed notifications as metadata snapshots, newest first.
   * @returns {Array<{id: string, title?: string, message?: string, type?: string, timestamp?: number}>}
   */
  getSuppressed() {
    return Array.from(this._suppressed.values()).reverse();
  }

  /**
   * Get the count of suppressed notifications.
   * @returns {number}
   */
  getSuppressedCount() {
    return this._suppressed.size;
  }

  _loadSuppressed() {
    try {
      const stored = localStorage.getItem(SUPPRESSED_STORAGE_KEY);
      if (!stored) return new Map();
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object') {
        return new Map(Object.entries(parsed));
      }
      return new Map();
    } catch {
      return new Map();
    }
  }

  _saveSuppressed() {
    try {
      localStorage.setItem(
        SUPPRESSED_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this._suppressed))
      );
    } catch {

      // localStorage unavailable (e.g. private browsing with storage blocked)
    }}

  /**
   * FIFO eviction, mirroring _archiveNotification's cap enforcement. Bounds
   * localStorage growth against a caller that suppresses many distinct ids
   * over the app's lifetime. Returns true if anything was evicted.
   */
  _evictOldestSuppressed() {
    let evicted = false;
    while (this._suppressed.size > this._SUPPRESSED_CAP) {
      this._suppressed.delete(this._suppressed.keys().next().value);
      evicted = true;
    }
    return evicted;
  }

  // ── Archive + undo internals ───────────────────────────────────────────

  /**
   * Move a notification from the active Map into the archive Map, evicting
   * oldest entries if the archive exceeds its cap. Returns the archived
   * notification or null if the id wasn't active.
   */
  _archiveNotification(id) {
    const notification = this.notifications.get(id);
    if (!notification) return null;
    // Archiving implies the user has acknowledged the notification, so it
    // is always stored as read. If the user later restores it, the dot
    // does not reappear — consistent with the "archive = seen" mental model.
    notification.unread = false;
    this.notifications.delete(id);
    this._archive.set(id, notification);
    // FIFO eviction. The first key returned by Map iteration is the
    // oldest insertion; size > cap guarantees it exists.
    while (this._archive.size > this._ARCHIVE_CAP) {
      this._archive.delete(this._archive.keys().next().value);
    }
    return notification;
  }

  /**
   * Open the undo window. The snackbar stays visible until the next user
   * interaction (tab switch, clicking another notification, closing the
   * popover) or until another dismiss replaces it — there is no auto-timeout.
   * Cancels any prior pending undo; the prior archived item stays archived.
   * Skipped silently when the panel isn't available (UI disabled).
   * @param {string} id - id covered by this undo window.
   * @param {string} [text] - Snackbar text override; defaults to
   *   "Notification archived" — suitable for plain dismissals.
   */
  _beginPendingUndo(id, text) {
    this._cancelPendingUndo();
    if (!this.ui?.hasPanel()) return;

    this._pendingUndo = { id };
    this.ui?.showSnackbar(text || av.i18n.translate('Notification archived'));
  }

  /**
   * Finalize the current pending undo without restoring — archived items
   * stay archived. Safe to call when nothing is pending.
   */
  _cancelPendingUndo() {
    if (!this._pendingUndo) return;
    this._pendingUndo = null;
    this.ui?.hideSnackbar();
  }

  /**
   * Apply the current pending undo — restores the pending id if still
   * present in the archive (silently no-ops if cap-evicted in the meantime).
   */
  _applyPendingUndo() {
    if (!this._pendingUndo) return;
    const { id } = this._pendingUndo;
    this._pendingUndo = null;
    this.ui?.hideSnackbar();

    if (this._restoreFromArchiveCore(id)) {
      this.ui?.refresh();
      logger.debug('Notification restored from archive:', id);
    }
  }

  /**
   * Move an id from the archive back into the active map and lift any
   * suppression on it. Pure state mutation — does not refresh the UI.
   * Returns true if a restore actually happened.
   */
  _restoreFromArchiveCore(id) {
    const notification = this._archive.get(id);
    if (!notification) return false;

    this._archive.delete(id);
    if (this._suppressed.has(id)) {
      this._suppressed.delete(id);
      this._saveSuppressed();
    }
    this.notifications.set(id, notification);
    return true;
  }

  /**
   * Restore an archived notification back into the active list. If the
   * notification was suppressed at dismiss time, the suppression is lifted
   * so the restored item is visible. Returns true if restored.
   * @param {string} id
   * @returns {boolean}
   */
  restoreFromArchive(id) {
    if (!this._restoreFromArchiveCore(id)) return false;
    this.ui?.refresh();
    logger.debug('Notification restored from archive:', id);
    return true;
  }

  /**
   * Clear the entire archive. Does not restore items.
   */
  clearArchive() {
    if (this._archive.size === 0) return;
    this._archive.clear();
    this.ui?.refreshContent();
  }

  /**
   * Get all archived notifications, newest first.
   * @returns {Array}
   */
  getArchive() {
    return Array.from(this._archive.values()).reverse();
  }

  /**
   * Get the count of archived notifications.
   * @returns {number}
   */
  getArchiveCount() {
    return this._archive.size;
  }

  /**
   * Get all notifications
   * @returns {Array} Array of notification objects
   */
  getNotifications() {
    return Array.from(this.notifications.values());
  }

  /**
   * Get notification count
   * @returns {number} Number of active notifications
   */
  getNotificationCount() {
    return this.notifications.size;
  }

}

av.theExtensionManager.registerExtension('Autodesk.NotificationManager', NotificationManagerExtension);
})();

Autodesk.Extensions.NotificationManager = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=NotificationManager.js.map