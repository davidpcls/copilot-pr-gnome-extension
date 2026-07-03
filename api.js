import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

const GITHUB_API_VERSION = '2026-03-10';
const USER_AGENT = 'github-review-requests-extension';
const RESULT_LIMIT = 10;

export class GitHubReviewApiClient {
    constructor() {
        this._session = new Soup.Session({
            timeout: 20,
            idle_timeout: 20,
        });
        this._retrySourceIds = new Set();
        this._destroyed = false;
    }

    destroy() {
        this._destroyed = true;
        for (const sourceId of this._retrySourceIds) {
            GLib.source_remove(sourceId);
        }
        this._retrySourceIds.clear();

        if (this._session) {
            this._session.abort();
            this._session = null;
        }
    }

    fetchReviewRequests({token, host, organization}, callback) {
        const safeHost = String(host ?? '').trim();
        const safeOrganization = String(organization ?? '').trim();
        const encodedQuery = GLib.uri_escape_string(
            `is:open is:pr review-requested:@me org:${safeOrganization} archived:false`,
            null,
            false
        );
        const url = `https://${safeHost}/api/v3/search/issues?q=${encodedQuery}&sort=updated&order=desc&per_page=${RESULT_LIMIT}`;
        this._requestWithRetry(url, token, 0, callback);
    }

    _requestWithRetry(url, token, attempt, callback) {
        if (this._destroyed) {
            return;
        }

        this._requestJson(url, token, (error, payload, statusCode, errorCode) => {
            if (!error) {
                callback(null, payload, statusCode, null);
                return;
            }

            if (this._isRetryable(statusCode, errorCode) && attempt < 2) {
                const delayMs = 500 * (2 ** attempt);
                const sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
                    this._retrySourceIds.delete(sourceId);
                    this._requestWithRetry(url, token, attempt + 1, callback);
                    return GLib.SOURCE_REMOVE;
                });
                this._retrySourceIds.add(sourceId);
                return;
            }

            callback(error, null, statusCode, errorCode);
        });
    }

    _requestJson(url, token, callback) {
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        message.request_headers.append('Accept', 'application/vnd.github+json');
        message.request_headers.append('X-GitHub-Api-Version', GITHUB_API_VERSION);
        message.request_headers.append('User-Agent', USER_AGENT);

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                if (this._destroyed) {
                    return;
                }

                const statusCode = message.status_code;

                let bytes;
                try {
                    bytes = session.send_and_read_finish(result);
                } catch (e) {
                    callback(new Error('request-failed'), null, statusCode || 0, 'request-failed');
                    return;
                }

                if (statusCode < 200 || statusCode >= 300) {
                    callback(new Error('http-error'), null, statusCode, 'http-error');
                    return;
                }

                try {
                    const decoder = new TextDecoder('utf-8');
                    const payload = JSON.parse(decoder.decode(bytes.get_data()));
                    callback(null, payload, statusCode, null);
                } catch (e) {
                    callback(new Error('invalid-json'), null, statusCode, 'invalid-json');
                }
            }
        );
    }

    _isRetryable(statusCode, errorCode) {
        if (errorCode === 'request-failed') {
            return true;
        }

        if (statusCode === 429) {
            return true;
        }

        if (statusCode >= 500) {
            return true;
        }

        return false;
    }
}

export function normalizeReviewSearchPayload(payload) {
    const totalCount = Number.isFinite(payload?.total_count) ? payload.total_count : 0;
    const items = Array.isArray(payload?.items) ? payload.items : [];

    return {
        count: Math.max(0, totalCount),
        pullRequests: items.slice(0, RESULT_LIMIT).map(item => ({
            id: Number.isFinite(item?.number) ? item.number : 0,
            title: String(item?.title ?? '').trim() || '(untitled)',
            url: String(item?.html_url ?? '').trim(),
            repository: String(item?.repository_url ?? '').trim(),
        })),
    };
}
