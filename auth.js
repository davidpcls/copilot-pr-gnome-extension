import Secret from 'gi://Secret';

const SECRET_SCHEMA = new Secret.Schema('org.gnome.shell.extensions.github-review-requests.token', Secret.SchemaFlags.NONE, {
    service: Secret.SchemaAttributeType.STRING,
    account: Secret.SchemaAttributeType.STRING,
});

const SECRET_ATTRIBUTES = {
    service: 'gnome-shell-extension',
    account: 'github-review-requests@davidpcls',
};

const SECRET_LABEL = 'GNOME Extension: GitHub Review Requests API Token';

export function extractTokenCandidate(rawValue) {
    const value = String(rawValue ?? '').trim();
    if (value === '') {
        return '';
    }

    const lowered = value.toLowerCase();
    if (lowered.startsWith('github_pat_') || lowered.startsWith('ghp_') || lowered.startsWith('gho_')) {
        return value;
    }

    if (lowered.startsWith('token ')) {
        return value.slice('token '.length).trim();
    }

    if (lowered.startsWith('bearer ')) {
        return value.slice('bearer '.length).trim();
    }

    return value;
}

export class TokenStore {
    migrateFromSettings(settings) {
        const legacyToken = extractTokenCandidate(settings.get_string('api-token'));
        if (legacyToken === '') {
            return;
        }

        try {
            this.storeToken(legacyToken);
            settings.set_string('api-token', '');
        } catch (e) {
            // Keep silent; UI will show keyring errors when token is needed.
        }
    }

    getToken() {
        try {
            const token = Secret.password_lookup_sync(SECRET_SCHEMA, SECRET_ATTRIBUTES, null);
            const parsed = extractTokenCandidate(token);
            if (parsed === '') {
                return {token: null, errorCode: 'missing-token'};
            }

            return {token: parsed, errorCode: null};
        } catch (e) {
            return {token: null, errorCode: 'keyring-unavailable'};
        }
    }

    hasStoredToken() {
        const result = this.getToken();
        return result.errorCode === null && result.token !== null;
    }

    storeToken(rawToken) {
        const token = extractTokenCandidate(rawToken);
        if (token === '') {
            throw new Error('empty-token');
        }

        const stored = Secret.password_store_sync(
            SECRET_SCHEMA,
            SECRET_ATTRIBUTES,
            Secret.COLLECTION_DEFAULT,
            SECRET_LABEL,
            token,
            null
        );

        if (!stored) {
            throw new Error('store-failed');
        }
    }

    clearToken() {
        Secret.password_clear_sync(SECRET_SCHEMA, SECRET_ATTRIBUTES, null);
    }
}
