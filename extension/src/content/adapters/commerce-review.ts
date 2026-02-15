import { BaseAdapter } from './base';
import type { CommerceReviewAdapterConfig, ReviewFilterOptions, ReviewItem } from './review-types';

export abstract class CommerceReviewAdapter extends BaseAdapter {
    protected abstract readonly config: CommerceReviewAdapterConfig;

    protected abstract normalizeProductUrl(rawUrl: string): string | null;

    protected abstract isProductPage(url: URL): boolean;

    protected abstract extractProductId(url: URL): string;

    protected cleanText(value: string | null | undefined): string {
        return (value || '').replace(/\s+/g, ' ').trim();
    }

    protected getElementText(root: ParentNode, selectors: string[]): string {
        for (const selector of selectors) {
            const node = root.querySelector(selector);
            if (!node) continue;
            const text = this.cleanText(node.textContent);
            if (text) return text;
        }
        return '';
    }

    protected getProductTitle(): string {
        for (const selector of this.config.productTitleSelectors) {
            const title = this.getElementText(document, [selector]);
            if (title) return this.normalizeTitle(title);
        }
        return this.normalizeTitle(this.cleanText(document.title));
    }

    protected normalizeTitle(title: string): string {
        if (!title) return '';
        if (this.config.titleSuffixPattern) {
            return title.replace(this.config.titleSuffixPattern, '').trim();
        }
        return title.trim();
    }

    protected fallbackTitleFromUrl(url: string): string {
        try {
            const itemId = this.extractProductId(new URL(url));
            if (itemId) return `${this.config.platformLabel}商品_${itemId}`;
        } catch (_) {
            // ignore
        }
        return `${this.config.platformLabel}商品`;
    }

    protected sanitizeReviewText(value: string): string {
        return this.cleanText(value)
            .replace(/\s*收起评论\s*/g, ' ')
            .replace(/\s*查看全部\s*/g, ' ')
            .trim();
    }

    protected htmlToPlainText(html: string): string {
        if (!html) return '';
        return html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<\/div>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    protected extractReviewContent(node: Element): string {
        for (const selector of this.config.reviewContentSelectors) {
            const target = node.querySelector(selector) as HTMLElement | null;
            if (!target) continue;

            const byInnerText = this.cleanText(target.innerText || target.textContent || '');
            const byHtml = this.htmlToPlainText(target.innerHTML || '');
            const content = this.sanitizeReviewText(byInnerText || byHtml);
            if (content) return content;
        }

        if (this.config.platformKey === 'jd') {
            const target = node.querySelector('.jdc-pc-rate-card-main-desc, .jdc-pc-rate-card-main') as HTMLElement | null;
            if (target) {
                const byInnerText = this.cleanText(target.innerText || target.textContent || '');
                const byHtml = this.htmlToPlainText(target.innerHTML || '');
                const content = this.sanitizeReviewText(byInnerText || byHtml);
                if (content) return content;
            }
        }

        return '';
    }

    protected getReviewFilterOptions(): ReviewFilterOptions {
        const minRating = Math.max(0, Math.min(5, Number(this.options?.reviewMinRating || 0)));
        const withImagesOnly = this.options?.reviewWithImagesOnly === true;
        const maxCount = Math.max(0, Number(this.options?.reviewMaxCount || 0));
        const recentDays = Math.max(0, Number(this.options?.reviewRecentDays || 0));

        return {
            minRating,
            withImagesOnly,
            maxCount,
            recentDays
        };
    }

    protected getReviewMaxPages(): number {
        const raw = Number(this.options?.reviewMaxPages || 1);
        if (!Number.isFinite(raw)) return 1;
        return Math.max(1, Math.min(50, Math.floor(raw)));
    }

    protected async prepareReviewCollection(): Promise<void> {
        return;
    }

    protected getReviewSearchRoots(): ParentNode[] {
        return [document];
    }

    protected reportProgress(message: string, extra: Record<string, any> = {}) {
        const requestId = this.cleanText(String(this.options?.extractRequestId || ''));
        if (!requestId) return;
        if (!chrome?.runtime?.sendMessage) return;

        try {
            chrome.runtime.sendMessage({
                action: 'EXTRACTION_PROGRESS',
                requestId,
                platform: this.config.platformKey,
                taskType: 'review',
                message,
                ...extra
            }, () => {
                void chrome.runtime.lastError;
            });
        } catch (_) {
            // ignore
        }
    }

    protected isElementVisible(el: Element): boolean {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    protected isDisabledPaginationNode(el: Element): boolean {
        if ((el as HTMLButtonElement).disabled) return true;
        const ariaDisabled = this.cleanText(el.getAttribute('aria-disabled')).toLowerCase();
        if (ariaDisabled === 'true') return true;
        const className = this.cleanText((el as HTMLElement).className).toLowerCase();
        return /disabled|forbid|ban/.test(className);
    }

    protected getReviewPageMarker(): string {
        const nodes = this.getTopLevelReviewNodes().slice(0, 3);
        const parts: string[] = [];
        for (const node of nodes) {
            const content = this.extractReviewContent(node);
            const user = this.cleanText(this.getElementText(node, this.config.reviewUserSelectors));
            const time = this.cleanText(this.getElementText(node, this.config.reviewTimeSelectors));
            parts.push(`${user}|${time}|${content}`);
        }
        return parts.join('||');
    }

    protected async waitForReviewPageChange(previousMarker: string): Promise<boolean> {
        const maxWaitMs = Math.max(3000, Number(this.options?.scrollWaitTime || 1500) * 4);
        const deadline = Date.now() + maxWaitMs;

        while (Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            const currentMarker = this.getReviewPageMarker();
            if (currentMarker && currentMarker !== previousMarker) {
                return true;
            }
        }

        return false;
    }

    protected findReviewNextPageNode(): HTMLElement | null {
        const selectors = this.config.reviewNextPageSelectors;
        const roots = this.getReviewSearchRoots();

        for (const selector of selectors) {
            for (const root of roots) {
                const nodes = Array.from(root.querySelectorAll(selector));
                for (const node of nodes) {
                    if (!this.isElementVisible(node)) continue;
                    if (this.isDisabledPaginationNode(node)) continue;
                    return node as HTMLElement;
                }
            }
        }

        for (const root of roots) {
            const genericNodes = Array.from(root.querySelectorAll('a,button,[role="button"]'));
            for (const node of genericNodes) {
                const text = this.cleanText(node.textContent).toLowerCase();
                const className = this.cleanText((node as HTMLElement).className).toLowerCase();
                const looksNext = text.includes('下一页') || text === 'next' || className.includes('next');
                if (!looksNext) continue;
                if (!this.isElementVisible(node)) continue;
                if (this.isDisabledPaginationNode(node)) continue;
                return node as HTMLElement;
            }
        }

        return null;
    }

    protected async gotoNextReviewPage(): Promise<boolean> {
        const markerBefore = this.getReviewPageMarker();
        const nextNode = this.findReviewNextPageNode();
        if (!nextNode) return false;

        nextNode.scrollIntoView({ behavior: 'auto', block: 'center' });
        nextNode.click();

        const changed = await this.waitForReviewPageChange(markerBefore);
        if (!changed) {
            await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Number(this.options?.scrollWaitTime || 1500))));
        }

        return changed;
    }

    protected parseReviewTime(timeText: string): Date | null {
        const raw = this.cleanText(timeText);
        if (!raw) return null;

        const normalized = raw
            .replace(/[年/.]/g, '-')
            .replace(/月/g, '-')
            .replace(/日/g, '')
            .replace(/\s+/g, ' ');

        const parsed = new Date(normalized);
        if (!Number.isNaN(parsed.getTime())) return parsed;

        const dateMatch = raw.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
        if (dateMatch) {
            const year = Number(dateMatch[1]);
            const month = Number(dateMatch[2]) - 1;
            const day = Number(dateMatch[3]);
            const maybeDate = new Date(year, month, day);
            if (!Number.isNaN(maybeDate.getTime())) return maybeDate;
        }

        const monthDayMatch = raw.match(/(^|\s)(\d{1,2})-(\d{1,2})(\s|$)/);
        if (monthDayMatch) {
            const now = new Date();
            let year = now.getFullYear();
            const month = Number(monthDayMatch[2]) - 1;
            const day = Number(monthDayMatch[3]);
            let maybeDate = new Date(year, month, day);
            if (maybeDate.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
                year -= 1;
                maybeDate = new Date(year, month, day);
            }
            if (!Number.isNaN(maybeDate.getTime())) return maybeDate;
        }

        return null;
    }

    protected inferReviewMetaFromNode(node: Element, draft: ReviewItem): ReviewItem {
        const metaText = this.getElementText(node, [
            '.jdc-pc-rate-card-main-info',
            '.jdc-pc-rate-main-info',
            '.jdc-pc-rate-card-info.top',
            '[class*="meta--"]',
            '[class*="meta"]',
            '.tm-rate-date',
            '.rate-date'
        ]);

        if (!metaText) return draft;

        let nextTime = draft.time;
        let nextSku = draft.sku;

        const dateMatch = metaText.match(/(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2})|(\d{1,2}-\d{1,2})/);
        const normalizedDate = dateMatch
            ? this.cleanText((dateMatch[1] || dateMatch[2] || '').replace(/[年/.]/g, '-').replace(/月/g, '-').replace(/日/g, ''))
            : '';

        if (nextTime && (nextTime.includes('已购') || nextTime.length > 24) && normalizedDate) {
            nextTime = normalizedDate;
        }

        if (!nextTime) {
            nextTime = normalizedDate;
        }

        if (!nextSku || (nextSku === draft.time && nextSku.includes('已购'))) {
            const purchasedMatch = metaText.match(/已购[:：]\s*([^\n]+)/);
            if (purchasedMatch && purchasedMatch[1]) {
                nextSku = this.cleanText(purchasedMatch[1]);
            }
        }

        if (!nextSku) {
            const normalized = metaText
                .replace(/[★☆⭐]+/g, ' ')
                .replace(/(\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2})|(\d{1,2}-\d{1,2})/g, ' ')
                .replace(/已购[:：]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (normalized && normalized !== metaText.trim()) {
                nextSku = normalized;
            }
        }

        return {
            ...draft,
            time: nextTime,
            sku: nextSku
        };
    }

    protected shouldKeepReview(review: ReviewItem, filters: ReviewFilterOptions): boolean {
        if (filters.minRating > 0 && (review.rating ?? 0) < filters.minRating) {
            return false;
        }

        if (filters.withImagesOnly && review.images.length === 0) {
            return false;
        }

        if (filters.recentDays > 0) {
            const reviewDate = this.parseReviewTime(review.time);
            if (reviewDate) {
                const threshold = Date.now() - filters.recentDays * 24 * 60 * 60 * 1000;
                if (reviewDate.getTime() < threshold) {
                    return false;
                }
            }
        }

        return true;
    }

    protected extractRating(node: Element): number | null {
        const attrCandidates = ['data-score', 'data-rate', 'score', 'rate'];
        for (const attr of attrCandidates) {
            const raw = node.getAttribute(attr);
            if (!raw) continue;
            const n = Number(raw);
            if (Number.isFinite(n) && n > 0) {
                if (n <= 5) return n;
                if (n <= 10) return n / 2;
            }
        }

        const ratingText = this.getElementText(node, this.config.reviewRatingSelectors);
        if (ratingText) {
            const textMatch = ratingText.match(/([1-5](?:\.\d+)?)(?:\s*[分星]|\s*\/\s*5)?/);
            if (textMatch && textMatch[1]) {
                const parsed = Number(textMatch[1]);
                if (Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 5) {
                    return parsed;
                }
            }
        }

        const activeStars = node.querySelectorAll('.star-on, .active, .filled, [class*="star-on"], [class*="starfull"], [class*="rate-star-light"], [class*="tm-rate-star"]');
        if (activeStars.length > 0 && activeStars.length <= 5) {
            return activeStars.length;
        }

        const starClassNode = node.querySelector('[class*="star-good"], [class*="star-level"], .jdc-pc-icon-star-good');
        if (starClassNode) {
            const className = this.cleanText((starClassNode as HTMLElement).className).toLowerCase();
            const matched = className.match(/star-(?:good|level)-([1-5])/);
            if (matched && matched[1]) {
                const n = Number(matched[1]);
                if (Number.isFinite(n) && n >= 1 && n <= 5) return n;
            }
            return 5;
        }

        const starByText = (node.textContent || '').match(/[★⭐]/g);
        if (starByText && starByText.length > 0 && starByText.length <= 5) {
            return starByText.length;
        }

        return null;
    }

    protected async collectReviewImages(node: Element): Promise<string[]> {
        const urls = new Set<string>();
        const images = Array.from(node.querySelectorAll('img')) as HTMLImageElement[];

        for (const img of images) {
            const className = String(img.className || '').toLowerCase();
            const altText = this.cleanText(img.getAttribute('alt')).toLowerCase();
            if (/avatar|head|user|face|logo/.test(className)) continue;
            if (/watermark|icon|star/.test(className)) continue;
            if (/avatar|头像|star|icon|logo|more|reply/.test(altText)) continue;
            if (img.closest('.jdc-avatar, [class*="avatar"], .jdc-pc-rate-card-user, .jdc-pc-rate-card-info-right, .jdc-btn-icon-with-count, .jdc-pc-rate-card-info.top')) continue;

            const width = Number(img.getAttribute('width') || img.width || 0);
            const height = Number(img.getAttribute('height') || img.height || 0);
            if ((width > 0 && width < 48) || (height > 0 && height < 48)) continue;

            const rawSrc = img.getAttribute('data-lazy-img')
                || img.getAttribute('data-lazyload')
                || img.getAttribute('data-original')
                || img.getAttribute('data-src')
                || img.getAttribute('src')
                || '';

            const src = this.cleanText(rawSrc);
            if (!src || src.startsWith('data:image/svg')) continue;

            const processed = await this.processImage(src);
            if (processed) urls.add(processed);
        }

        const bgNodes = Array.from(node.querySelectorAll('[style*="background-image"], [data-src], [data-original], [data-lazy-img]')) as HTMLElement[];
        for (const bgNode of bgNodes) {
            const className = this.cleanText(bgNode.className).toLowerCase();
            if (/avatar|head|user|face|logo/.test(className)) continue;
            if (/watermark|icon|star/.test(className)) continue;

            const candidates = [
                this.cleanText(bgNode.getAttribute('data-src')),
                this.cleanText(bgNode.getAttribute('data-original')),
                this.cleanText(bgNode.getAttribute('data-lazy-img')),
                this.cleanText(bgNode.style.backgroundImage),
                this.cleanText(window.getComputedStyle(bgNode).backgroundImage)
            ].filter(Boolean);

            for (const candidate of candidates) {
                let src = candidate;
                const urlMatches = Array.from(candidate.matchAll(/url\((['"]?)(.*?)\1\)/g));
                if (urlMatches.length > 0) {
                    src = this.cleanText(urlMatches[0]?.[2] || '');
                }

                if (!src || src === 'none' || src.startsWith('data:image/svg')) continue;
                const processed = await this.processImage(src);
                if (processed) urls.add(processed);
            }
        }

        return Array.from(urls);
    }

    protected getTopLevelReviewNodes(): Element[] {
        const nodeMap = new Map<Element, true>();
        const roots = this.getReviewSearchRoots();

        for (const selector of this.config.reviewNodeSelectors) {
            for (const root of roots) {
                const nodes = Array.from(root.querySelectorAll(selector));
                nodes.forEach(node => nodeMap.set(node, true));
            }
        }

        const allNodes = Array.from(nodeMap.keys());
        return allNodes.filter(node => !allNodes.some(other => other !== node && other.contains(node)));
    }

    protected async collectReviews(): Promise<ReviewItem[]> {
        await this.prepareReviewCollection();

        const filters = this.getReviewFilterOptions();
        const maxPages = this.getReviewMaxPages();
        const dedup = new Set<string>();
        const reviews: ReviewItem[] = [];
        let page = 1;

        while (page <= maxPages) {
            const nodes = this.getTopLevelReviewNodes();
            if (nodes.length === 0 && page > 1) break;

            for (const node of nodes) {
                const content = this.extractReviewContent(node);
                const user = this.cleanText(this.getElementText(node, this.config.reviewUserSelectors));
                const time = this.cleanText(this.getElementText(node, this.config.reviewTimeSelectors));
                const sku = this.cleanText(this.getElementText(node, this.config.reviewSkuSelectors));
                const rating = this.extractRating(node);
                const images = await this.collectReviewImages(node);

                if (!content && images.length === 0) continue;

                const key = `${user}|${time}|${content}`;
                if (dedup.has(key)) continue;
                dedup.add(key);

                const review = this.inferReviewMetaFromNode(node, {
                    user: user || '匿名用户',
                    time,
                    sku,
                    rating,
                    content,
                    images
                });

                if (!this.shouldKeepReview(review, filters)) {
                    continue;
                }

                reviews.push(review);

                if (filters.maxCount > 0 && reviews.length >= filters.maxCount) {
                    return reviews;
                }
            }

            if (page >= maxPages) break;
            const moved = await this.gotoNextReviewPage();
            if (!moved) break;
            page += 1;
        }

        return reviews;
    }

    protected escapeHtml(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    protected buildReviewMarkdown(productTitle: string, productId: string, pageUrl: string, reviews: ReviewItem[]): string {
        const lines: string[] = [];
        lines.push(`# ${productTitle}`);
        lines.push('');
        lines.push(`- 平台：${this.config.platformLabel}`);
        if (productId) lines.push(`- 商品ID：${productId}`);
        lines.push(`- 抓取链接：${pageUrl}`);
        lines.push(`- 抓取时间：${new Date().toLocaleString()}`);
        lines.push('');
        lines.push(`## 评论列表（${reviews.length} 条）`);
        lines.push('');

        if (reviews.length === 0) {
            lines.push('> 当前页面未匹配到可抓取评论，请先滚动到评论区后重试。');
            lines.push('');
            return lines.join('\n');
        }

        reviews.forEach((review, idx) => {
            lines.push(`### ${idx + 1}. ${review.user}`);
            if (review.rating !== null) lines.push(`- 评分：${review.rating}/5`);
            if (review.time) lines.push(`- 时间：${review.time}`);
            if (review.sku) lines.push(`- 规格：${review.sku}`);
            if (review.content) lines.push(`- 内容：${review.content}`);
            if (review.images.length > 0) {
                lines.push('- 图片：');
                review.images.forEach(img => lines.push(`  - <img src="${img}" referrerpolicy="no-referrer" alt="review-image" />`));
            }
            lines.push('');
        });

        return lines.join('\n');
    }

    protected buildReviewHtml(productTitle: string, productId: string, pageUrl: string, reviews: ReviewItem[]): string {
        const title = this.escapeHtml(productTitle);
        const safeUrl = this.escapeHtml(pageUrl);
        const header = [
            `<h1>${title}</h1>`,
            `<p><strong>平台</strong>: ${this.config.platformLabel}</p>`,
            productId ? `<p><strong>商品ID</strong>: ${this.escapeHtml(productId)}</p>` : '',
            `<p><strong>抓取链接</strong>: <a href="${safeUrl}">${safeUrl}</a></p>`,
            `<p><strong>抓取时间</strong>: ${this.escapeHtml(new Date().toLocaleString())}</p>`,
            `<h2>评论列表（${reviews.length} 条）</h2>`
        ].filter(Boolean).join('');

        if (reviews.length === 0) {
            return `${header}<p>当前页面未匹配到可抓取评论，请先滚动到评论区后重试。</p>`;
        }

        const items = reviews.map((review, idx) => {
            const meta = [
                review.rating !== null ? `<p><strong>评分</strong>: ${review.rating}/5</p>` : '',
                review.time ? `<p><strong>时间</strong>: ${this.escapeHtml(review.time)}</p>` : '',
                review.sku ? `<p><strong>规格</strong>: ${this.escapeHtml(review.sku)}</p>` : ''
            ].filter(Boolean).join('');

            const images = review.images.length > 0
                ? `<div>${review.images.map(img => `<img src="${this.escapeHtml(img)}" referrerpolicy="no-referrer" alt="review-image" style="max-width: 180px; margin: 6px 8px 0 0;" />`).join('')}</div>`
                : '';

            return `<section><h3>${idx + 1}. ${this.escapeHtml(review.user)}</h3>${meta}<p><strong>内容</strong>: ${this.escapeHtml(review.content || '')}</p>${images}</section>`;
        }).join('');

        return `${header}${items}`;
    }

    protected escapeCsvCell(value: string): string {
        const text = String(value ?? '');
        return `"${text.replace(/"/g, '""')}"`;
    }

    protected buildReviewCsv(productTitle: string, productId: string, pageUrl: string, reviews: ReviewItem[]): string {
        const lines: string[] = [];
        lines.push('platform,product_title,product_id,source_url,captured_at,index,user,time,sku,rating,content,image_urls');

        const capturedAt = new Date().toISOString();
        reviews.forEach((review, idx) => {
            const columns = [
                this.config.platformLabel,
                productTitle,
                productId,
                pageUrl,
                capturedAt,
                String(idx + 1),
                review.user,
                review.time,
                review.sku,
                review.rating === null ? '' : String(review.rating),
                review.content,
                review.images.join('|')
            ];
            lines.push(columns.map((cell) => this.escapeCsvCell(cell)).join(','));
        });

        return lines.join('\n');
    }

    protected buildReviewJson(productTitle: string, productId: string, pageUrl: string, reviews: ReviewItem[]): string {
        const payload = {
            platform: this.config.platformLabel,
            productTitle,
            productId,
            sourceUrl: pageUrl,
            capturedAt: new Date().toISOString(),
            reviewCount: reviews.length,
            filters: this.getReviewFilterOptions(),
            reviews
        };

        return JSON.stringify(payload, null, 2);
    }

    async scanLinks(): Promise<{ title: string; url: string }[]> {
        const result: { title: string; url: string }[] = [];
        const seen = new Set<string>();

        const pushLink = (rawUrl: string, rawTitle: string) => {
            const normalizedUrl = this.normalizeProductUrl(rawUrl);
            if (!normalizedUrl || seen.has(normalizedUrl)) return;
            seen.add(normalizedUrl);

            const title = this.cleanText(rawTitle) || this.fallbackTitleFromUrl(normalizedUrl);
            result.push({ title, url: normalizedUrl });
        };

        for (const selector of this.config.scanLinkSelectors) {
            const anchors = Array.from(document.querySelectorAll(selector)) as HTMLAnchorElement[];
            for (const anchor of anchors) {
                const href = anchor.href || anchor.getAttribute('href') || '';
                if (!href) continue;

                const title = this.cleanText(anchor.getAttribute('title'))
                    || this.cleanText(anchor.textContent)
                    || this.cleanText(anchor.querySelector('img')?.getAttribute('alt'));
                pushLink(href, title);
            }
        }

        try {
            const currentUrl = new URL(window.location.href);
            if (this.isProductPage(currentUrl)) {
                pushLink(window.location.href, this.getProductTitle());
            }
        } catch (_) {
            // ignore
        }

        return result;
    }

    async extract() {
        const pageUrl = window.location.href.split('#')[0];
        let productId = '';
        try {
            productId = this.extractProductId(new URL(window.location.href));
        } catch (_) {
            // ignore
        }

        const title = this.getProductTitle() || this.fallbackTitleFromUrl(pageUrl);
        const reviews = await this.collectReviews();

        if (this.imageStats.total > 0) {
            console.log(`[ImageProcess] Completed ${this.imageStats.done}/${this.imageStats.total}, failed=${this.imageStats.failed}`);
        }

        let content = '';
        if (this.format === 'html') {
            content = this.buildReviewHtml(title, productId, pageUrl, reviews);
        } else if (this.format === 'csv') {
            content = this.buildReviewCsv(title, productId, pageUrl, reviews);
        } else if (this.format === 'json') {
            content = this.buildReviewJson(title, productId, pageUrl, reviews);
        } else {
            content = this.buildReviewMarkdown(title, productId, pageUrl, reviews);
        }

        return { content, images: this.images };
    }
}
