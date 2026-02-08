export class ImageUtils {
    /**
     * Fetch image as Blob (handles credentials/referrer)
     * @param url 
     * @returns {Promise<Blob>}
     */
    static async fetchBlob(url: string): Promise<Blob> {
        try {
            const response = await fetch(url, { referrerPolicy: 'no-referrer', credentials: 'include' });
            const contentType = response.headers.get("content-type");
            if (contentType && (contentType.includes("application/json") || contentType.includes("text/html"))) {
                throw new Error("Response is not an image");
            }
            return await response.blob();
        } catch (e) {
            console.warn('Image fetch failed:', url, e);
            throw e;
        }
    }

    /**
     * Convert an image URL to a Base64 string.
     * @param url - The URL of the image.
     * @returns {Promise<string>} - The Base64 string.
     */
    static async urlToBase64(url: string): Promise<string> {
        try {
            const blob = await this.fetchBlob(url);
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            console.warn('Base64 conversion skipped:', url);
            return url;
        }
    }
}

export class CryptoUtils {
    static async hmacSha1(keyString: string, dataString: string): Promise<ArrayBuffer> {
        const encoder = new TextEncoder();
        const keyData = encoder.encode(keyString);
        const algorithm: HmacImportParams = { name: "HMAC", hash: "SHA-1" };
        const key = await crypto.subtle.importKey("raw", keyData, algorithm, false, ["sign"]);
        const signature = await crypto.subtle.sign(algorithm.name, key, encoder.encode(dataString));
        return signature;
    }

    static async hmacSha256(key: string | Uint8Array | ArrayBuffer, dataString: string): Promise<ArrayBuffer> {
        const encoder = new TextEncoder();
        let keyData: Uint8Array | ArrayBuffer;
        if (typeof key === 'string') {
            keyData = encoder.encode(key);
        } else {
            keyData = key;
        }

        const algorithm: HmacImportParams = { name: "HMAC", hash: "SHA-256" };
        const cryptoKey = await crypto.subtle.importKey("raw", keyData as any, algorithm, false, ["sign"]);
        const signature = await crypto.subtle.sign(algorithm.name, cryptoKey, encoder.encode(dataString));
        return signature; // ArrayBuffer
    }

    static async sha256(data: string | ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
        const encoder = new TextEncoder();
        let buffer: Uint8Array | ArrayBuffer;
        if (typeof data === 'string') {
            buffer = encoder.encode(data);
        } else {
            buffer = data;
        }
        const hash = await crypto.subtle.digest("SHA-256", buffer as any);
        return hash; // ArrayBuffer
    }

    static bufferToHex(buffer: ArrayBuffer): string {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    static bufferToBase64(buffer: ArrayBuffer): string {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
}

export class ImageUploader {
    /**
     * Upload blob to configured storage
     * @param blob 
     * @param filename 
     * @param config 
     */
    static async upload(blob: Blob, filename: string, config: any): Promise<string> {
        if (!config || !config.enabled) throw new Error("Upload disabled");

        // Generate path
        let path = config.folder || '';
        if (path && !path.endsWith('/') && !path.startsWith('/')) path += '/';
        const objectKey = path + filename;

        if (config.provider === 'aliyun') {
            return this.uploadAliyun(blob, objectKey, config);
        } else if (config.provider === 's3') {
            return this.uploadS3(blob, objectKey, config);
        }
        throw new Error("Unknown provider");
    }

    static async uploadAliyun(blob: Blob, objectKey: string, config: any): Promise<string> {
        const date = new Date().toUTCString();
        const contentType = blob.type || 'application/octet-stream';
        const bucket = config.bucket;
        const endpoint = config.endpoint; // e.g., oss-cn-hangzhou.aliyuncs.com
        const host = `${bucket}.${endpoint}`;
        const url = `https://${host}/${objectKey}`;

        const canonicalizedResource = `/${bucket}/${objectKey}`;
        const policy = `PUT\n\n${contentType}\n${date}\n${canonicalizedResource}`;

        const signatureBuffer = await CryptoUtils.hmacSha1(config.accessKeySecret, policy);
        const signature = CryptoUtils.bufferToBase64(signatureBuffer);
        const auth = `OSS ${config.accessKeyId}:${signature}`;

        const response = await fetch(url, {
            method: 'PUT',
            headers: {
                'Content-Type': contentType,
                'Date': date,
                'Authorization': auth
            },
            body: blob
        });

        if (!response.ok) {
            throw new Error(`Aliyun Upload Failed: ${response.status} ${response.statusText}`);
        }

        // Return URL
        if (config.domain) {
            let domain = config.domain;
            if (!domain.endsWith('/')) domain += '/';
            return domain + objectKey;
        }
        return `https://${host}/${objectKey}`;
    }

    static async uploadS3(blob: Blob, objectKey: string, config: any): Promise<string> {
        const region = config.region || 'us-east-1';
        const bucket = config.bucket;
        // Handle endpoint normalization
        let endpoint = config.endpoint;
        // Remove protocol if present for splitting, but keep for fetch URL
        let protocol = 'https://';
        if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
            const u = new URL(endpoint);
            endpoint = u.host;
            protocol = u.protocol + '//';
        }

        const isAws = endpoint.includes('amazonaws.com');
        let url: string, host: string, uriPath: string;

        if (!isAws) {
            // Path compatible (MinIO)
            host = endpoint;
            url = `${protocol}${host}/${bucket}/${objectKey}`;
            uriPath = `/${bucket}/${objectKey}`;
        } else {
            // Virtual Host (AWS)
            host = `${bucket}.${endpoint}`;
            url = `${protocol}${host}/${objectKey}`;
            uriPath = `/${objectKey}`;
        }

        const method = 'PUT';
        const service = 's3';
        const contentType = blob.type || 'application/octet-stream';

        const now = new Date();
        const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
        const dateStamp = amzDate.slice(0, 8); // YYYYMMDD

        // 1. Canonical Request
        // Payload Hash
        const blobBuffer = await blob.arrayBuffer();
        const payloadHashBuf = await CryptoUtils.sha256(blobBuffer);
        const payloadHash = CryptoUtils.bufferToHex(payloadHashBuf);

        // Canonical Headers
        const canonicalUri = uriPath.split('/').map(c => encodeURIComponent(c)).join('/').replace(/%2F/g, '/');
        const canonicalQuerystring = '';
        const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
        const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

        const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuerystring}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

        // 2. String to Sign
        const algorithm = 'AWS4-HMAC-SHA256';
        const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
        const canonicalRequestHash = CryptoUtils.bufferToHex(await CryptoUtils.sha256(canonicalRequest));
        const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

        // 3. Signature
        const getSignatureKey = async (key: string, date: string, region: string, service: string) => {
            const kDate = await CryptoUtils.hmacSha256("AWS4" + key, date);
            const kRegion = await CryptoUtils.hmacSha256(kDate, region);
            const kService = await CryptoUtils.hmacSha256(kRegion, service);
            const kSigning = await CryptoUtils.hmacSha256(kService, "aws4_request");
            return new Uint8Array(kSigning);
        };

        const signingKey = await getSignatureKey(config.accessKeySecret, dateStamp, region, service);
        const signatureBuf = await CryptoUtils.hmacSha256(signingKey, stringToSign);
        const signature = CryptoUtils.bufferToHex(signatureBuf);

        const authorizationHeader = `${algorithm} Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

        const headers = {
            'Authorization': authorizationHeader,
            'x-amz-date': amzDate,
            'x-amz-content-sha256': payloadHash, // Required for SigV4 in many cases
            'Content-Type': contentType
        };

        const response = await fetch(url, {
            method: 'PUT',
            headers: headers,
            body: blob
        });

        if (!response.ok) {
            const txt = await response.text();
            throw new Error(`S3/MinIO Upload Failed: ${response.status} ${txt}`);
        }

        // Return URL
        if (config.domain) {
            let domain = config.domain;
            if (!domain.endsWith('/')) domain += '/';
            return domain + objectKey;
        }
        return url;
    }
}

export class DomUtils {
    /**
     * Wait for an element to appear in the DOM.
     * @param selector - CSS selector.
     * @returns {Promise<Element>}
     */
    static waitForElement(selector: string): Promise<Element> {
        return new Promise(resolve => {
            const existing = document.querySelector(selector);
            if (existing) {
                return resolve(existing);
            }

            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    resolve(el);
                    observer.disconnect();
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    }

    /**
     * Create an element with optional attributes and children.
     * @param tag
     * @param attributes
     * @param children
     * @returns {HTMLElement}
     */
    static createElement(tag: string, attributes: any = {}, children: Array<Node | string> = []): HTMLElement {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) {
            if (key === 'style' && typeof value === 'object' && value !== null) {
                Object.assign(el.style, value);
            } else if (key === 'className') {
                el.className = value as string;
            } else if (key.startsWith('on') && typeof value === 'function') {
                el.addEventListener(key.substring(2).toLowerCase(), value as EventListener);
            } else {
                el.setAttribute(key, value as string);
            }
        }
        children.forEach(child => {
            if (typeof child === 'string') {
                el.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                el.appendChild(child);
            }
        });
        return el;
    }
}
