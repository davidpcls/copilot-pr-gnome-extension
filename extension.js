import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {TokenStore} from './auth.js';
import {GitHubReviewApiClient, normalizeReviewSearchPayload} from './api.js';

const MIN_REFRESH_INTERVAL_SECONDS = 10;
const LIST_LIMIT = 10;

function parseRepositoryName(repositoryUrl) {
    const text = String(repositoryUrl ?? '').trim();
    if (text === '') {
        return '';
    }

    const match = text.match(/\/repos\/([^/]+)\/([^/]+)$/);
    if (!match) {
        return '';
    }

    return `${match[1]}/${match[2]}`;
}

const ReviewRequestsIndicator = GObject.registerClass(
class ReviewRequestsIndicator extends PanelMenu.Button {
    _init(settings, openPreferences) {
        super._init(0.0, 'GitHub Review Requests');

        this._settings = settings;
        this._openPreferences = openPreferences;
        this._apiClient = new GitHubReviewApiClient();
        this._tokenStore = new TokenStore();
        this._isRefreshing = false;
        this._pendingRefresh = false;

        this._tokenStore.migrateFromSettings(this._settings);

        this._box = new St.BoxLayout({
            style_class: 'panel-status-menu-box',
        });
        this._label = new St.Label({
            text: 'PR: —',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'github-review-value',
        });
        this._box.add_child(this._label);
        this.add_child(this._box);

        this._createMenu();
        this._setUnavailableState('Loading...');

        this._settingsSignalIds = [
            this._settings.connect('changed::refresh-interval', () => this._restartTimer()),
            this._settings.connect('changed::review-org-slug', () => this._refreshNow()),
            this._settings.connect('changed::github-host', () => this._refreshNow()),
        ];

        this._refreshNow();
        this._startTimer();
    }

    _createMenu() {
        const sectionBox = new St.BoxLayout({
            style_class: 'github-review-section',
            vertical: true,
            x_expand: true,
        });

        const header = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'github-review-header',
        });
        this._titleLabel = new St.Label({
            text: 'Requested Reviews',
            style_class: 'github-review-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        this._countLabel = new St.Label({
            text: 'Open: —',
            style_class: 'github-review-value',
            x_align: Clutter.ActorAlign.END,
        });
        header.add_child(this._titleLabel);
        header.add_child(this._countLabel);
        sectionBox.add_child(header);

        this._statusLabel = new St.Label({
            text: 'Loading...',
            style_class: 'github-review-detail',
        });
        sectionBox.add_child(this._statusLabel);

        const sectionItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        sectionItem.add_child(sectionBox);
        this.menu.addMenuItem(sectionItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._dynamicItemsStartIndex = this.menu.numMenuItems;

        const footerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        const footerBox = new St.BoxLayout({
            style_class: 'github-review-footer',
            x_expand: true,
        });

        const refreshContent = new St.BoxLayout({
            style_class: 'github-review-button-content',
        });
        const refreshIcon = new St.Icon({
            icon_name: 'view-refresh-symbolic',
            icon_size: 14,
            y_align: Clutter.ActorAlign.CENTER,
        });
        refreshContent.add_child(refreshIcon);
        this._refreshLabel = new St.Label({
            text: 'Refresh',
            y_align: Clutter.ActorAlign.CENTER,
        });
        refreshContent.add_child(this._refreshLabel);

        this._refreshButton = new St.Button({
            style_class: 'github-review-button',
            can_focus: true,
            reactive: true,
            track_hover: true,
        });
        this._refreshButton.set_child(refreshContent);
        this._refreshButton.connect('clicked', () => this._refreshNow());
        footerBox.add_child(this._refreshButton);

        this._lastUpdatedLabel = new St.Label({
            text: 'Checked: —',
            style_class: 'github-review-last-updated',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        footerBox.add_child(this._lastUpdatedLabel);

        footerItem.add_child(footerBox);
        this.menu.addMenuItem(footerItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => {
            this._openPreferences();
        });
        this.menu.addMenuItem(settingsItem);
    }

    _startTimer() {
        const configuredInterval = this._settings.get_int('refresh-interval');
        const interval = Math.max(MIN_REFRESH_INTERVAL_SECONDS, configuredInterval);
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._refreshNow();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    _restartTimer() {
        this._stopTimer();
        this._startTimer();
    }

    _refreshNow() {
        if (this._isRefreshing) {
            this._pendingRefresh = true;
            return;
        }

        this._isRefreshing = true;
        this._setRefreshing(true);

        const organization = this._settings.get_string('review-org-slug').trim().replace(/^@+/, '');
        const host = this._settings.get_string('github-host').trim();

        if (organization === '') {
            this._setUnavailableState('Set organization slug in settings');
            this._finishRefresh();
            return;
        }

        if (host === '') {
            this._setUnavailableState('Set GitHub host in settings');
            this._finishRefresh();
            return;
        }

        const tokenResult = this._tokenStore.getToken();
        if (tokenResult.errorCode !== null) {
            this._setUnavailableState(this._friendlyTokenError(tokenResult.errorCode));
            this._finishRefresh();
            return;
        }

        this._apiClient.fetchReviewRequests(
            {
                token: tokenResult.token,
                host,
                organization,
            },
            (error, payload, statusCode, errorCode) => {
                if (error) {
                    if (statusCode !== 404) {
                        const safeStatus = typeof statusCode === 'number' ? statusCode : 0;
                        const safeReason = errorCode ?? 'unknown';
                        console.error(`GitHub Review Requests: request failed (status=${safeStatus}, reason=${safeReason})`);
                    }

                    this._setUnavailableState(this._friendlyApiError(statusCode));
                    this._finishRefresh();
                    return;
                }

                const data = normalizeReviewSearchPayload(payload);
                this._applyReviewData(data, organization, host);
                this._finishRefresh();
            }
        );
    }

    _applyReviewData(data, organization, host) {
        this._label.set_text(`PR: ${data.count}`);
        this._countLabel.set_text(`Open: ${data.count}`);
        this._statusLabel.set_text(`Org: ${organization} @ ${host}`);

        this._clearDynamicListItems();
        if (data.pullRequests.length === 0) {
            const emptyItem = new PopupMenu.PopupMenuItem('No open review requests', {
                reactive: false,
            });
            this._markDynamicItem(emptyItem);
            this.menu.addMenuItem(emptyItem, this._dynamicItemsStartIndex);
            return;
        }

        const list = data.pullRequests.slice(0, LIST_LIMIT);
        for (const pr of list) {
            const repoName = parseRepositoryName(pr.repository);
            const repoPrefix = repoName !== '' ? `${repoName} ` : '';
            const title = `${repoPrefix}#${pr.id} ${pr.title}`;
            const item = new PopupMenu.PopupMenuItem(title);
            item.label.add_style_class_name('github-review-pr-item');
            item.connect('activate', () => {
                if (pr.url !== '') {
                    Gio.AppInfo.launch_default_for_uri(pr.url, null);
                }
            });
            this._markDynamicItem(item);
            this.menu.addMenuItem(item, this._dynamicItemsStartIndex);
        }
    }

    _clearDynamicListItems() {
        const items = this.menu._getMenuItems().filter(item => item?._githubReviewDynamicItem === true);
        for (const item of items) {
            item.destroy();
        }
    }

    _markDynamicItem(item) {
        item._githubReviewDynamicItem = true;
    }

    _setUnavailableState(detail) {
        this._label.set_text('PR: —');
        this._countLabel.set_text('Open: —');
        this._statusLabel.set_text(detail);

        this._clearDynamicListItems();
        const messageItem = new PopupMenu.PopupMenuItem(detail, {
            reactive: false,
        });
        this._markDynamicItem(messageItem);
        this.menu.addMenuItem(messageItem, this._dynamicItemsStartIndex);
    }

    _friendlyTokenError(errorCode) {
        if (errorCode === 'keyring-unavailable') {
            return 'Keyring unavailable. Unlock login keyring and set API token';
        }

        return 'Set API token in settings';
    }

    _friendlyApiError(statusCode) {
        if (statusCode === 401) {
            return 'Invalid API token';
        }

        if (statusCode === 403) {
            return 'Token lacks access to org PR review requests';
        }

        if (statusCode === 404) {
            return 'Host, org, or endpoint unavailable';
        }

        if (statusCode && statusCode > 0) {
            return `HTTP ${statusCode}`;
        }

        return 'Network request failed';
    }

    _setRefreshing(isRefreshing) {
        if (isRefreshing) {
            this._refreshLabel.set_text('Refreshing...');
            this._refreshButton.add_style_class_name('busy');
        } else {
            this._refreshLabel.set_text('Refresh');
            this._refreshButton.remove_style_class_name('busy');
        }
    }

    _updateLastCheckedLabel() {
        const now = GLib.DateTime.new_now_local();
        this._lastUpdatedLabel.set_text(`Checked: ${now.format('%H:%M:%S')}`);
    }

    _finishRefresh() {
        this._setRefreshing(false);
        this._updateLastCheckedLabel();
        this._isRefreshing = false;

        if (this._pendingRefresh) {
            this._pendingRefresh = false;
            this._refreshNow();
        }
    }

    destroy() {
        this._stopTimer();
        this._apiClient?.destroy();
        this._apiClient = null;

        if (this._settingsSignalIds) {
            for (const signalId of this._settingsSignalIds) {
                this._settings.disconnect(signalId);
            }
            this._settingsSignalIds = null;
        }

        super.destroy();
    }
});

export default class GitHubReviewRequestsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new ReviewRequestsIndicator(
            this._settings,
            () => this.openPreferences()
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
