import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {TokenStore} from './auth.js';

export default class GitHubReviewRequestsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const tokenStore = new TokenStore();

        const page = new Adw.PreferencesPage({
            title: 'GitHub Review Requests Settings',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        const orgGroup = new Adw.PreferencesGroup({
            title: 'Organization',
            description: 'Filter requested reviews to one GitHub organization',
        });
        page.add(orgGroup);

        const orgRow = new Adw.EntryRow({
            title: 'Organization Slug',
            show_apply_button: true,
        });
        orgRow.set_text(settings.get_string('review-org-slug'));
        orgRow.connect('apply', () => {
            settings.set_string('review-org-slug', orgRow.get_text().trim().replace(/^@+/, ''));
        });
        orgGroup.add(orgRow);

        const hostRow = new Adw.EntryRow({
            title: 'GitHub Host',
            show_apply_button: true,
        });
        hostRow.set_text(settings.get_string('github-host'));
        hostRow.connect('apply', () => {
            const value = hostRow.get_text().trim();
            settings.set_string('github-host', value === '' ? 'github.com' : value);
        });
        orgGroup.add(hostRow);

        const hostHint = new Gtk.Label({
            label: 'Examples: github.com or github.example.com (GHES).',
            xalign: 0,
            wrap: true,
            css_classes: ['dim-label', 'caption'],
            margin_start: 12,
            margin_top: 4,
        });
        orgGroup.add(hostHint);

        const refreshGroup = new Adw.PreferencesGroup({
            title: 'Refresh',
            description: 'Polling interval for review requests',
        });
        page.add(refreshGroup);

        const refreshRow = new Adw.SpinRow({
            title: 'Refresh Interval',
            subtitle: 'Seconds between API polls',
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 3600,
                step_increment: 10,
                page_increment: 60,
                value: settings.get_int('refresh-interval'),
            }),
        });
        settings.bind(
            'refresh-interval',
            refreshRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        refreshGroup.add(refreshRow);

        const authGroup = new Adw.PreferencesGroup({
            title: 'Authentication',
            description: 'Store your API token securely in the login keyring',
        });
        page.add(authGroup);

        const tokenRow = new Adw.EntryRow({
            title: 'GitHub API Token',
            show_apply_button: true,
        });
        tokenRow.set_input_purpose(Gtk.InputPurpose.PASSWORD);
        tokenRow.set_text('');

        const tokenStatusLabel = new Gtk.Label({
            xalign: 0,
            wrap: true,
            css_classes: ['dim-label', 'caption'],
            margin_start: 12,
            margin_top: 4,
        });

        const updateTokenStatus = (override = null) => {
            if (typeof override === 'string') {
                tokenStatusLabel.set_label(override);
                return;
            }

            tokenStatusLabel.set_label(tokenStore.hasStoredToken()
                ? 'Token stored in login keyring'
                : 'No token stored in login keyring');
        };

        tokenRow.connect('apply', () => {
            const value = tokenRow.get_text().trim();
            let success = false;
            try {
                if (value === '') {
                    tokenStore.clearToken();
                } else {
                    tokenStore.storeToken(value);
                }
                success = true;
            } catch (e) {
                updateTokenStatus('Failed to store token. Unlock login keyring and try again');
            }

            tokenRow.set_text('');
            if (success) {
                updateTokenStatus();
            }
        });
        updateTokenStatus();
        authGroup.add(tokenRow);
        authGroup.add(tokenStatusLabel);

        const clearTokenRow = new Adw.ActionRow({
            title: 'Clear Stored Token',
            subtitle: 'Remove token from your login keyring',
        });
        const clearTokenButton = new Gtk.Button({
            label: 'Clear',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        clearTokenButton.connect('clicked', () => {
            try {
                tokenStore.clearToken();
            } catch (e) {
                updateTokenStatus('Failed to clear token from keyring');
                return;
            }
            tokenRow.set_text('');
            updateTokenStatus();
        });
        clearTokenRow.add_suffix(clearTokenButton);
        authGroup.add(clearTokenRow);
    }
}
