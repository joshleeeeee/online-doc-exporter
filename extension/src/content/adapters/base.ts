import { ImageUtils, ImageUploader } from '../utils';

export abstract class BaseAdapter {
    format: string;
    options: any;
    images: { filename: string; base64: string }[] = [];
    imageProcessCache = new Map<string, Promise<string>>();
    imageStats = { total: 0, done: 0, failed: 0, lastLogAt: 0 };

    constructor(format: string, options: any = {}) {
        this.format = format;
        this.options = options;
    }

    abstract extract(): Promise<{ content: string; images: any[] }>;
    abstract scanLinks(): Promise<{ title: string; url: string }[]>;

    logImageProgress(force = false) {
        const now = Date.now();
        if (!force && now - this.imageStats.lastLogAt < 2000) return;
        this.imageStats.lastLogAt = now;
        if (this.imageStats.total === 0) return;
        console.log(`[ImageProcess] ${this.imageStats.done}/${this.imageStats.total} done, failed=${this.imageStats.failed}`);
    }

    private sanitizePathSegment(value: string): string {
        const cleaned = (value || '')
            .trim()
            .toLowerCase()
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
        return (cleaned || 'document').slice(0, 48);
    }

    private inferImageExt(blob: Blob, src: string): string {
        const mimeSubtype = (blob.type.split('/')[1] || '').toLowerCase();
        const mimeExt = mimeSubtype.split('+')[0];
        if (/^[a-z0-9]{2,10}$/.test(mimeExt)) return mimeExt;
        const fromSrc = src.match(/\.([a-z0-9]{2,10})(?:[?#]|$)/i)?.[1]?.toLowerCase();
        return fromSrc || 'png';
    }

    private shortHashFromString(input: string): string {
        // 32-bit FNV-1a hash as deterministic fallback when crypto.subtle is unavailable.
        let hash = 0x811c9dc5;
        for (let i = 0; i < input.length; i++) {
            hash ^= input.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    private async shortHashFromBlob(blob: Blob, src: string): Promise<string> {
        const seed = `${blob.type}|${blob.size}|${src}`;
        try {
            if (globalThis.crypto?.subtle) {
                const prefix = new TextEncoder().encode(seed);
                const sample = new Uint8Array(await blob.slice(0, 64 * 1024).arrayBuffer());
                const merged = new Uint8Array(prefix.length + sample.length);
                merged.set(prefix, 0);
                merged.set(sample, prefix.length);
                const digest = await crypto.subtle.digest('SHA-1', merged);
                const bytes = new Uint8Array(digest).slice(0, 4);
                return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
            }
        } catch (_) {
            // Fall through to deterministic string hash.
        }
        return this.shortHashFromString(seed);
    }

    private async buildLocalImageFilename(blob: Blob, src: string): Promise<string> {
        const ext = this.inferImageExt(blob, src);
        const seq = String(this.images.length + 1).padStart(4, '0');
        const preferredTitle = this.options?.batchItemTitle || document.title || 'document';
        const docSegment = this.sanitizePathSegment(preferredTitle);
        const hash = await this.shortHashFromBlob(blob, src);
        return `${docSegment}/image_${seq}_${hash}.${ext}`;
    }

    async processImageInternal(src: string, mode: string): Promise<string> {
        const timeoutMs = this.options?.imageTimeoutMs || 20_000;
        const retries = this.options?.imageRetries ?? 2;

        // 1. Upload to OSS/MinIO
        if (mode === 'minio' && this.options.imageConfig && this.options.imageConfig.enabled) {
            try {
                let blob: Blob;
                if (src.startsWith('data:')) {
                    const res = await fetch(src);
                    blob = await res.blob();
                } else {
                    blob = await ImageUtils.fetchBlob(src, { timeoutMs, retries });
                }

                const ext = blob.type.split('/')[1] || 'png';
                const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

                const newUrl = await ImageUploader.upload(blob, filename, this.options.imageConfig);
                return newUrl;
            } catch (e) {
                console.error("Upload failed, falling back to original/base64", e);
            }
        }

        // 2. Base64
        if (mode === 'base64' && !src.startsWith("data:")) {
            return await ImageUtils.urlToBase64(src);
        }

        // 3. Local (ZIP)
        if (mode === 'local') {
            try {
                let blob: Blob;
                if (src.startsWith('data:')) {
                    const res = await fetch(src);
                    blob = await res.blob();
                } else {
                    blob = await ImageUtils.fetchBlob(src, { timeoutMs, retries });
                }

                const filename = await this.buildLocalImageFilename(blob, src);

                const reader = new FileReader();
                const base64 = await new Promise<string>((resolve) => {
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.readAsDataURL(blob);
                });

                this.images.push({
                    filename: filename,
                    base64: base64
                });

                return `images/${filename}`;
            } catch (e) {
                console.warn("Local image fetch failed", e);
                return src;
            }
        }

        return src;
    }

    async processImage(src: string): Promise<string> {
        if (!src) return '';

        const mode = this.options.imageMode || 'original';
        if (mode === 'original') return src;

        const cacheKey = `${mode}:${src}`;
        const cached = this.imageProcessCache.get(cacheKey);
        if (cached) return await cached;

        this.imageStats.total += 1;
        this.logImageProgress();

        const task = (async () => {
            let failed = false;
            try {
                const result = await this.processImageInternal(src, mode);
                if (result === src && mode !== 'original' && !src.startsWith('data:')) {
                    failed = true;
                }
                return result;
            } catch (_) {
                failed = true;
                return src;
            } finally {
                this.imageStats.done += 1;
                if (failed) this.imageStats.failed += 1;
                this.logImageProgress(true);
            }
        })();

        this.imageProcessCache.set(cacheKey, task);
        return await task;
    }
}
