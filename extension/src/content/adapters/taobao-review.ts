import { CommerceReviewAdapter } from './commerce-review';
import type { CommerceReviewAdapterConfig, ReviewItem } from './review-types';

export class TaobaoReviewAdapter extends CommerceReviewAdapter {
    private reviewRoot: Element | null = null;
    private allCommentsTriggered = false;
    private allCommentsReady = false;

    protected readonly config: CommerceReviewAdapterConfig = {
        platformKey: 'taobao',
        platformLabel: '淘宝/天猫',
        scanLinkSelectors: [
            'a[href*="item.taobao.com/item.htm"]',
            'a[href*="detail.tmall.com/item.htm"]',
            'a[href*="chaoshi.detail.tmall.com/item.htm"]'
        ],
        productTitleSelectors: [
            '.tb-main-title',
            '.tb-detail-hd h1',
            '.tb-title',
            '.tm-fcs-panel h1',
            'h1'
        ],
        reviewNodeSelectors: [
            '[class^="Comment--"]',
            '[class*=" Comment--"]',
            '[class*="Comment--"]',
            '.rate-grid .rate-item',
            '.tm-rate-item',
            '.rate-list .rate-item',
            '.tb-revbd',
            '.J_KgRate_ReviewItem',
            '[class*="rate-item"]',
            '[class*="review-item"]'
        ],
        reviewContentSelectors: [
            '[class*="contentWrapper"] > [class*="content--"]',
            '[class*="contentWrapper"] [class*="content--"]',
            '.tm-rate-fulltxt',
            '.rate-content',
            '.review-content',
            '.tb-tbcr-content',
            '[class*="fulltxt"]',
            '[class*="rate-content"]',
            '[class*="review-content"]',
            'p'
        ],
        reviewUserSelectors: [
            '[class*="userInfo"] [class*="userName"] span',
            '[class*="userName"] span',
            '[class*="userName"]',
            '.tm-rate-user-info',
            '.rate-user-info',
            '.user-nick',
            '.nick',
            '[class*="user-info"]',
            '[class*="userInfo"]'
        ],
        reviewTimeSelectors: [
            '[class*="meta--"]',
            '[class*="meta"]',
            '.tm-rate-date',
            '.rate-date',
            '.review-date',
            '[class*="rate-date"]',
            '[class*="date"]',
            '[class*="time"]'
        ],
        reviewSkuSelectors: [
            '[class*="meta--"]',
            '[class*="meta"]',
            '.tm-rate-sku',
            '.rate-sku',
            '.tm-m-attrs',
            '.sku',
            '[class*="rate-sku"]',
            '[class*="sku"]',
            '[class*="spec"]'
        ],
        reviewRatingSelectors: [
            '.tm-rate-star',
            '.rate-star',
            '.star',
            '.tm-rate-score',
            '[class*="rate-star"]',
            '[class*="star"]'
        ],
        reviewNextPageSelectors: [
            '.tm-rate-page .tm-rate-page-next',
            '.rate-page .rate-page-next',
            '.next-pagination-item.next',
            '.next-btn-next',
            '[class*="rate-page"] [class*="next"]'
        ],
        titleSuffixPattern: /\s*[-|｜]\s*(淘宝网|天猫|tmall|taobao).*$/i
    };

    protected getReviewSearchRoots(): ParentNode[] {
        if (this.reviewRoot) {
            if (this.allCommentsTriggered) {
                return [this.reviewRoot, document];
            }
            return [this.reviewRoot];
        }
        return [document];
    }

    private hasReviewNodes(root: ParentNode): boolean {
        return this.config.reviewNodeSelectors.some((selector) => !!root.querySelector(selector));
    }

    private isAllCommentsLabel(text: string): boolean {
        const value = this.cleanText(text);
        if (!value) return false;
        if (value === '查看全部评价' || value === '全部评价' || value === '全部评论') return true;
        if (/^查看全部评价\s*\(\d+\)$/.test(value)) return true;
        return false;
    }

    private isLikelyAllCommentsButton(node: HTMLElement): boolean {
        if (!this.isElementVisible(node)) return false;
        const text = this.cleanText(node.textContent);
        if (!text) return false;
        if (!this.isAllCommentsLabel(text) && !text.includes('查看全部评价') && !text.includes('全部评价') && !text.includes('全部评论')) {
            return false;
        }
        if (text.length > 24) return false;

        const rect = node.getBoundingClientRect();
        if (rect.width < 24 || rect.height < 16) return false;
        if (rect.width > 480 || rect.height > 120) return false;

        return true;
    }

    private isAllCommentsButtonStillVisible(node: HTMLElement | null): boolean {
        if (!node) return false;
        if (!document.contains(node)) return false;
        if (!this.isElementVisible(node)) return false;
        const text = this.cleanText(node.textContent);
        return this.isAllCommentsLabel(text) || text.includes('查看全部评价') || text.includes('全部评价') || text.includes('全部评论');
    }

    private findAllCommentsButton(): HTMLElement | null {
        const selectors = [
            '[class^="ShowButton--"]',
            '[class*=" ShowButton--"]',
            '[class*="ShowButton--"]',
            '[class*="ShowButton"]'
        ];

        for (const selector of selectors) {
            const nodes = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
            for (const node of nodes) {
                if (this.isLikelyAllCommentsButton(node)) {
                    return node;
                }
            }
        }

        const byText = Array.from(document.querySelectorAll('div,button,a,span')) as HTMLElement[];
        for (const node of byText) {
            if (this.isLikelyAllCommentsButton(node)) {
                return node;
            }
        }

        return null;
    }

    private triggerAllCommentsButton(node: HTMLElement): void {
        const target = node;
        target.scrollIntoView({ behavior: 'auto', block: 'center' });

        try {
            target.click();
        } catch (_) {
            // ignore
        }

        const rect = target.getBoundingClientRect();
        const clientX = rect.left + Math.max(2, Math.min(rect.width - 2, rect.width / 2));
        const clientY = rect.top + Math.max(2, Math.min(rect.height - 2, rect.height / 2));
        const eventInit: MouseEventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            button: 0,
            buttons: 1,
            clientX,
            clientY
        };

        target.dispatchEvent(new MouseEvent('mousedown', eventInit));
        target.dispatchEvent(new MouseEvent('mouseup', eventInit));
        target.dispatchEvent(new MouseEvent('click', eventInit));
    }

    private hasExpandedCommentsScroller(root: ParentNode): boolean {
        const selectors = [
            '[class^="comments--"][class*="beautify-scroll-bar"]',
            '[class*=" comments--"][class*="beautify-scroll-bar"]',
            '[class*="comments--"][class*="beautify-scroll-bar"]'
        ];

        for (const selector of selectors) {
            const nodes = Array.from(root.querySelectorAll(selector));
            for (const node of nodes) {
                if (!(node instanceof HTMLElement)) continue;
                if (!this.isElementVisible(node)) continue;
                const overflowY = window.getComputedStyle(node).overflowY.toLowerCase();
                if (overflowY === 'scroll' || overflowY === 'auto' || overflowY === 'overlay') {
                    return true;
                }
            }
        }

        return false;
    }

    private findReviewRootCandidate(anchorButton?: HTMLElement | null): Element | null {
        if (anchorButton) {
            const direct = anchorButton.closest('[class*="Comment"], [class*="Rate"], [class*="review"], [role="dialog"]') as Element | null;
            if (direct && this.isElementVisible(direct)) {
                if (this.hasReviewNodes(direct)) {
                    const allowDirect = !this.allCommentsTriggered || this.hasExpandedCommentsScroller(direct);
                    if (allowDirect) return direct;
                }
            }
        }

        const selectors = this.allCommentsTriggered
            ? [
                '[class*="Drawer--"]',
                '[class*="Drawer"]',
                '[class*="drawer"]',
                '[role="dialog"]',
                '[class*="CommentList"]',
                '[class*="Comments"]',
                '[class*="commentList"]',
                '[class*="comment-list"]',
                '[class*="rateList"]',
                '[class*="overlay"]'
            ]
            : [
                '[class*="CommentList"]',
                '[class*="Comments"]',
                '[class*="commentList"]',
                '[class*="comment-list"]',
                '[class*="rateList"]',
                '[class*="overlay"]',
                '[class*="drawer"]',
                '[role="dialog"]'
            ];

        let firstVisible: Element | null = null;
        let reviewFallback: Element | null = null;
        for (const selector of selectors) {
            const nodes = Array.from(document.querySelectorAll(selector));
            for (const node of nodes) {
                if (!this.isElementVisible(node)) continue;
                if (!firstVisible) firstVisible = node;
                if (!this.hasReviewNodes(node)) continue;

                if (!this.allCommentsTriggered) {
                    return node;
                }

                if (this.hasExpandedCommentsScroller(node)) {
                    return node;
                }

                if (!reviewFallback) {
                    reviewFallback = node;
                }
            }
        }

        return reviewFallback || firstVisible;
    }

    protected async prepareReviewCollection(): Promise<void> {
        this.reportProgress('正在定位评论区...');

        this.allCommentsTriggered = false;
        this.allCommentsReady = false;

        const rootBefore = this.findReviewRootCandidate();
        let allButton = this.findAllCommentsButton();

        if (!allButton) {
            const waitForButtonMs = Math.max(2000, Number(this.options?.scrollWaitTime || 1500) * 2);
            const buttonDeadline = Date.now() + waitForButtonMs;
            while (!allButton && Date.now() < buttonDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                allButton = this.findAllCommentsButton();
            }
        }

        if (allButton) {
            this.reportProgress('正在打开全部评价...');
            this.allCommentsTriggered = true;
            this.triggerAllCommentsButton(allButton);
            this.reviewRoot = this.findReviewRootCandidate(allButton);
        } else if (rootBefore && this.hasReviewNodes(rootBefore)) {
            this.reviewRoot = rootBefore;
            this.allCommentsReady = true;
            this.reportProgress('已定位评论区，开始抓取可见评论');
            return;
        }

        const timeoutMs = Math.max(5000, Number(this.options?.scrollWaitTime || 1500) * 5);
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const root = this.findReviewRootCandidate(allButton);
            if (root) {
                this.reviewRoot = root;
                if (this.hasReviewNodes(root)) {
                    const rootChanged = !!rootBefore && root !== rootBefore;
                    const buttonHidden = this.allCommentsTriggered && !this.isAllCommentsButtonStillVisible(allButton);
                    if (!this.allCommentsTriggered || rootChanged || buttonHidden) {
                        this.allCommentsReady = true;
                        this.reportProgress('评论区已展开，开始增量抓取');
                        return;
                    }
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        if (this.allCommentsTriggered) {
            this.reviewRoot = this.findReviewRootCandidate(allButton);
            this.reportProgress('未检测到全部评价面板，停止抓取（需先展开全部评价）', { done: true, total: 0 });
            return;
        }

        this.reviewRoot = this.findReviewRootCandidate(allButton) || rootBefore;
        if (this.reviewRoot && this.hasReviewNodes(this.reviewRoot)) {
            this.allCommentsReady = true;
            this.reportProgress('评论区容器已定位，继续尝试抓取');
        } else {
            this.reportProgress('未找到评论区容器，将尝试抓取当前可见内容');
        }
    }

    private isScrollableContainer(el: Element): el is HTMLElement {
        if (!(el instanceof HTMLElement)) return false;
        if (!this.isElementVisible(el)) return false;
        const overflowY = window.getComputedStyle(el).overflowY.toLowerCase();
        const allowsScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
        const delta = el.scrollHeight - el.clientHeight;
        return delta > 40 && allowsScroll;
    }

    private hasCommentChildren(root: ParentNode): boolean {
        if (root instanceof Element) {
            if (root.matches('[class^="Comment--"], [class*=" Comment--"], [class*="Comment--"]')) {
                return true;
            }
        }
        return !!root.querySelector('[class^="Comment--"], [class*=" Comment--"], [class*="Comment--"]');
    }

    private getScrollableReviewContainer(): HTMLElement | null {
        const roots = this.getReviewSearchRoots();
        const selectors = [
            '[class^="comments--"][class*="beautify-scroll-bar"]',
            '[class*=" comments--"][class*="beautify-scroll-bar"]',
            '[class*="comments--"][class*="beautify-scroll-bar"]',
            '[class^="comments--"]',
            '[class*=" comments--"]',
            '[class*="comments--"]',
            '[class*="virtual-scroll"]',
            '[class*="CommentList"]',
            '[class*="comments"][class*="scroll"]',
            '[class*="comments"]',
            '[class*="scroll"]',
            '[class*="drawer"]',
            '[role="dialog"]'
        ];

        let fallback: HTMLElement | null = null;

        for (const root of roots) {
            for (const selector of selectors) {
                const nodes = Array.from(root.querySelectorAll(selector));
                for (const node of nodes) {
                    if (!(node instanceof HTMLElement)) continue;

                    const className = this.cleanText(node.className);
                    const isExplicitCommentsScroller = className.includes('comments--') && className.includes('beautify-scroll-bar');
                    if (isExplicitCommentsScroller && this.isElementVisible(node) && this.hasCommentChildren(node)) {
                        return node;
                    }

                    if (this.isScrollableContainer(node)) {
                        if (this.hasCommentChildren(node)) {
                            return node;
                        }
                        if (!fallback) fallback = node;
                    }
                }
            }

            if (root instanceof HTMLElement && this.isScrollableContainer(root)) {
                if (this.hasCommentChildren(root)) {
                    return root;
                }
                if (!fallback) fallback = root;
            }
        }

        return fallback;
    }

    protected async collectReviews(): Promise<ReviewItem[]> {
        await this.prepareReviewCollection();

        if (!this.allCommentsReady) {
            this.reportProgress('评论抓取结束：未成功展开全部评价，未提取评论', { done: true, total: 0 });
            return [];
        }

        const filters = this.getReviewFilterOptions();
        const dedup = new Set<string>();
        const reviews: ReviewItem[] = [];

        const collectVisibleNodes = async (): Promise<number> => {
            const nodes = this.getTopLevelReviewNodes();
            let added = 0;

            for (const node of nodes) {
                const content = this.extractReviewContent(node);
                const user = this.cleanText(this.getElementText(node, this.config.reviewUserSelectors));
                const time = this.cleanText(this.getElementText(node, this.config.reviewTimeSelectors));
                const key = `${user}|${time}|${content}`;
                if (dedup.has(key)) continue;

                const sku = this.cleanText(this.getElementText(node, this.config.reviewSkuSelectors));
                const rating = this.extractRating(node);
                const images = await this.collectReviewImages(node);

                if (!content && images.length === 0) continue;

                const review = this.inferReviewMetaFromNode(node, {
                    user: user || '匿名用户',
                    time,
                    sku,
                    rating,
                    content,
                    images
                });

                dedup.add(key);

                if (!this.shouldKeepReview(review, filters)) {
                    continue;
                }

                reviews.push(review);
                added += 1;

                if (filters.maxCount > 0 && reviews.length >= filters.maxCount) {
                    return added;
                }
            }

            return added;
        };

        await collectVisibleNodes();
        this.reportProgress(`评论抓取中：累计 ${reviews.length} 条（初始化）`, { round: 0, total: reviews.length });
        if (filters.maxCount > 0 && reviews.length >= filters.maxCount) {
            this.reportProgress(`评论抓取完成：共 ${reviews.length} 条`, { done: true, total: reviews.length });
            return reviews;
        }

        const scrollContainer = this.getScrollableReviewContainer();
        if (!scrollContainer) {
            this.reportProgress(`评论抓取完成：共 ${reviews.length} 条（未找到滚动容器）`, { done: true, total: reviews.length });
            return reviews;
        }

        const step = Math.max(240, Math.floor(scrollContainer.clientHeight * 0.8));
        const estimatedRounds = Math.ceil(Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight) / Math.max(1, step)) + 10;
        const maxRounds = Math.max(20, this.getReviewMaxPages() * 20, estimatedRounds);
        const waitMs = Math.max(250, Number(this.options?.scrollWaitTime || 1200));

        this.reportProgress('开始滚动评论容器并增量抓取...', {
            round: 0,
            total: reviews.length,
            maxRounds
        });

        let idleRounds = 0;
        let previousTop = -1;
        let noMoveRounds = 0;

        for (let round = 0; round < maxRounds; round++) {
            const beforeTop = scrollContainer.scrollTop;
            const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
            const targetTop = Math.min(maxTop, scrollContainer.scrollTop + step);

            scrollContainer.scrollTo({ top: targetTop, behavior: 'auto' });
            if (Math.abs(scrollContainer.scrollTop - targetTop) > 2) {
                scrollContainer.scrollTop = targetTop;
            }
            if (Math.abs(scrollContainer.scrollTop - beforeTop) < 2) {
                try {
                    scrollContainer.dispatchEvent(new WheelEvent('wheel', {
                        deltaY: step,
                        bubbles: true,
                        cancelable: true
                    }));
                } catch (_) {
                    // ignore
                }
            }
            scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, waitMs));

            if (Math.abs(scrollContainer.scrollTop - beforeTop) < 2) {
                noMoveRounds += 1;
            } else {
                noMoveRounds = 0;
            }

            const added = await collectVisibleNodes();
            this.reportProgress(`评论抓取中：第 ${round + 1} 轮，新增 ${added} 条，累计 ${reviews.length} 条`, {
                round: round + 1,
                added,
                total: reviews.length,
                maxRounds
            });

            if (filters.maxCount > 0 && reviews.length >= filters.maxCount) {
                this.reportProgress(`评论抓取完成：达到条数上限，共 ${reviews.length} 条`, { done: true, total: reviews.length });
                break;
            }

            if (added === 0) {
                idleRounds += 1;
            } else {
                idleRounds = 0;
            }

            const canScrollNow = scrollContainer.scrollHeight - scrollContainer.clientHeight > 8;
            const reachedBottom = canScrollNow && scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 8;
            const stuck = Math.abs(scrollContainer.scrollTop - previousTop) < 2;
            previousTop = scrollContainer.scrollTop;

            if (reachedBottom && idleRounds >= 2) {
                this.reportProgress(`评论抓取完成：滚动到底部，共 ${reviews.length} 条`, { done: true, total: reviews.length });
                break;
            }

            if (!canScrollNow && noMoveRounds >= 8 && idleRounds >= 4) {
                this.reportProgress(`评论抓取完成：滚动容器无法继续滚动，共 ${reviews.length} 条`, { done: true, total: reviews.length });
                break;
            }

            if (stuck && idleRounds >= 4) {
                this.reportProgress(`评论抓取完成：无新增内容，共 ${reviews.length} 条`, { done: true, total: reviews.length });
                break;
            }
        }

        this.reportProgress(`评论抓取结束：共 ${reviews.length} 条`, { done: true, total: reviews.length });

        return reviews;
    }

    protected normalizeProductUrl(rawUrl: string): string | null {
        let url: URL;
        try {
            url = new URL(rawUrl, window.location.origin);
        } catch (_) {
            return null;
        }

        const host = url.hostname.toLowerCase();
        if (!host.includes('taobao.com') && !host.includes('tmall.com')) return null;
        if (!/\/item\.htm/i.test(url.pathname)) return null;

        const itemId = this.extractProductId(url);
        if (!itemId) return null;

        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

        // NOTE:
        // For Taobao/Tmall links, some pages require extra query params
        // (beyond id) to reliably enter the full detail context and load
        // review panel variants. Keep the original query string.
        url.hash = '';
        return url.toString();
    }

    protected isProductPage(url: URL): boolean {
        const host = url.hostname.toLowerCase();
        const isDetailHost = host.includes('item.taobao.com') || host.includes('detail.tmall.com');
        return isDetailHost && /\/item\.htm/i.test(url.pathname) && !!this.extractProductId(url);
    }

    protected extractProductId(url: URL): string {
        const itemId = url.searchParams.get('id') || '';
        if (/^\d+$/.test(itemId)) return itemId;
        return '';
    }
}
