import { CommerceReviewAdapter } from './commerce-review';
import type { CommerceReviewAdapterConfig, ReviewItem } from './review-types';

export class JdReviewAdapter extends CommerceReviewAdapter {
    private reviewRoot: Element | null = null;

    protected readonly config: CommerceReviewAdapterConfig = {
        platformKey: 'jd',
        platformLabel: '京东',
        scanLinkSelectors: [
            'a[href*="item.jd.com/"]',
            'a[href*="item.m.jd.com/product/"]',
            'a[href*="item-yiyao.jd.com/"]',
            'a[href*="item.jd.hk/"]'
        ],
        productTitleSelectors: [
            '.sku-name',
            '.item-name',
            '.p-name h1',
            'h1'
        ],
        reviewNodeSelectors: [
            '.jdc-pc-rate-card',
            '.jdc-pc-rate-card-content',
            'div[class*="listitem"] > .jdc-pc-rate-card',
            '.comment-item',
            '.J-comment-item',
            '.comment-list .item',
            '.comment-list .comment-item',
            '[class*="comment-item"]',
            '[class*="commentItem"]'
        ],
        reviewContentSelectors: [
            '.jdc-pc-rate-main-desc',
            '.jdc-pc-rate-main',
            '.comment-con',
            '.comment-content',
            '.comment-column',
            '.comment-text',
            '[class*="comment-con"]',
            '[class*="commentCon"]',
            'p'
        ],
        reviewUserSelectors: [
            '.jdc-pc-rate-card-nick',
            '.jdc-pc-rate-card-user .jdc-pc-rate-card-nick',
            '.user-info',
            '.comment-user',
            '.user-name',
            '[class*="user-name"]',
            '[class*="userName"]'
        ],
        reviewTimeSelectors: [
            '.jdc-pc-rate-card-info .date.list',
            '.jdc-pc-rate-card-info .date',
            '.jdc-pc-rate-card-date',
            '.jdc-pc-rate-card-main-info',
            '.order-info',
            '.comment-time',
            '.time',
            '[class*="comment-time"]',
            '[class*="commentTime"]',
            '[class*="date"]'
        ],
        reviewSkuSelectors: [
            '.jdc-pc-rate-card-info .info',
            '.jdc-pc-rate-card-sku',
            '.jdc-pc-rate-card-main-info',
            '.comment-tag',
            '.spec',
            '.sku',
            '.comment-item-title',
            '[class*="sku"]',
            '[class*="spec"]'
        ],
        reviewRatingSelectors: [
            '.jdc-pc-rate-stars',
            '.jdc-pc-rate-star',
            '.comment-star',
            '.star',
            '.score',
            '[class*="comment-star"]',
            '[class*="commentStar"]',
            '[class*="star"]'
        ],
        reviewNextPageSelectors: [
            '.ui-pager-next',
            '.J-pager-next',
            '.ui-pager a.fp-next',
            '.comment-list [class*="pager-next"]',
            '[class*="comment"] [class*="next"]'
        ],
        titleSuffixPattern: /\s*[-|｜]\s*(京东|jd\.com).*$/i
    };

    protected getReviewSearchRoots(): ParentNode[] {
        if (this.reviewRoot) {
            return [this.reviewRoot];
        }
        return [document];
    }

    private hasReviewNodes(root: ParentNode): boolean {
        return this.config.reviewNodeSelectors.some((selector) => !!root.querySelector(selector));
    }

    private findRelativeReviewRootFromAllButton(button: HTMLElement): Element | null {
        const directOverlay = button.closest('#rateList, .jdc-page-overlay, [class*="jdc-page-overlay"]') as Element | null;
        if (directOverlay) {
            const listContainer = directOverlay.querySelector('[class*="rateListContainer_"]') as Element | null;
            return listContainer || directOverlay;
        }

        const block = button.closest('div');
        if (block?.parentElement) {
            const siblingContainer = block.parentElement.querySelector('[class*="rateListContainer_"], [class*="rateListContainer"]') as Element | null;
            if (siblingContainer) return siblingContainer;
        }

        return null;
    }

    private findReviewRootCandidate(anchorButton?: HTMLElement | null): Element | null {
        if (anchorButton) {
            const relativeRoot = this.findRelativeReviewRootFromAllButton(anchorButton);
            if (relativeRoot && this.isElementVisible(relativeRoot)) {
                return relativeRoot;
            }
        }

        const selectors = [
            '#rateList [class*="rateListContainer_"]',
            '#rateList [class*="rateListContainer"]',
            '#rateList .jdc-page-overlay',
            '#rateList',
            '[class*="rateListContainer_"]',
            '[class*="rateListContainer"]',
            '.jdc-page-overlay'
        ];

        let firstVisible: Element | null = null;
        for (const selector of selectors) {
            const nodes = Array.from(document.querySelectorAll(selector));
            for (const node of nodes) {
                if (!this.isElementVisible(node)) continue;
                if (!firstVisible) firstVisible = node;
                if (this.hasReviewNodes(node)) return node;
            }
        }

        return firstVisible;
    }

    private findAllCommentsButton(): HTMLElement | null {
        const selectors = [
            '.all-btn',
            '[class*="all-btn"]',
            '[class*="allBtn"]',
            '#rateList .all-btn',
            '#comment .all-btn'
        ];

        for (const selector of selectors) {
            const nodes = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
            for (const node of nodes) {
                if (!this.isElementVisible(node)) continue;
                const text = this.cleanText(node.textContent);
                if (text.includes('全部评价') || text.includes('全部评论')) {
                    return node;
                }
            }
        }

        const byText = Array.from(document.querySelectorAll('div,button,a')) as HTMLElement[];
        for (const node of byText) {
            if (!this.isElementVisible(node)) continue;
            const text = this.cleanText(node.textContent);
            if (text === '全部评价' || text === '全部评论') {
                return node;
            }
        }

        return null;
    }

    protected async prepareReviewCollection(): Promise<void> {
        this.reportProgress('正在定位评论区...');

        const rootBefore = this.findReviewRootCandidate();
        if (rootBefore && this.hasReviewNodes(rootBefore)) {
            this.reviewRoot = rootBefore;
            this.reportProgress('已定位评论区，开始抓取可见评论');
            return;
        }

        const allButton = this.findAllCommentsButton();
        if (allButton) {
            this.reportProgress('正在打开全部评价...');
            allButton.scrollIntoView({ behavior: 'auto', block: 'center' });
            allButton.click();
            this.reviewRoot = this.findReviewRootCandidate(allButton);
        }

        const timeoutMs = Math.max(5000, Number(this.options?.scrollWaitTime || 1500) * 5);
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            const root = this.findReviewRootCandidate(allButton);
            if (root) {
                this.reviewRoot = root;
                if (this.hasReviewNodes(root)) {
                    this.reportProgress('评论区已展开，开始增量抓取');
                    return;
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        this.reviewRoot = this.findReviewRootCandidate(allButton);
        if (this.reviewRoot) {
            this.reportProgress('评论区容器已定位，继续尝试抓取');
        } else {
            this.reportProgress('未找到评论区容器，将尝试抓取当前可见内容');
        }
    }

    private isScrollableContainer(el: Element): el is HTMLElement {
        if (!(el instanceof HTMLElement)) return false;
        if (!this.isElementVisible(el)) return false;
        const canScroll = el.scrollHeight - el.clientHeight > 40;
        return canScroll;
    }

    private getScrollableReviewContainer(): HTMLElement | null {
        const roots = this.getReviewSearchRoots();
        const selectors = [
            '[class^="_rateListContainer_"]',
            '[class*="rateListContainer_"]',
            '[class*="rateListContainer"]',
            '[class*="virtual-scroll"]',
            '[class*="scroll"]'
        ];

        for (const root of roots) {
            for (const selector of selectors) {
                const nodes = Array.from(root.querySelectorAll(selector));
                for (const node of nodes) {
                    if (this.isScrollableContainer(node)) {
                        return node;
                    }
                }
            }

            if (root instanceof HTMLElement && this.isScrollableContainer(root)) {
                return root;
            }
        }

        return null;
    }

    protected async collectReviews(): Promise<ReviewItem[]> {
        await this.prepareReviewCollection();

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

        const maxRounds = Math.max(20, this.getReviewMaxPages() * 20);
        const waitMs = Math.max(250, Number(this.options?.scrollWaitTime || 1200));
        const step = Math.max(240, Math.floor(scrollContainer.clientHeight * 0.8));

        this.reportProgress('开始滚动评论容器并增量抓取...', {
            round: 0,
            total: reviews.length,
            maxRounds
        });

        let idleRounds = 0;
        let previousTop = -1;

        for (let round = 0; round < maxRounds; round++) {
            const maxTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
            const targetTop = Math.min(maxTop, scrollContainer.scrollTop + step);

            scrollContainer.scrollTop = targetTop;
            scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, waitMs));

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

            const reachedBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 8;
            const stuck = Math.abs(scrollContainer.scrollTop - previousTop) < 2;
            previousTop = scrollContainer.scrollTop;

            if (reachedBottom && idleRounds >= 2) {
                this.reportProgress(`评论抓取完成：滚动到底部，共 ${reviews.length} 条`, { done: true, total: reviews.length });
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
        if (!host.includes('jd.com') && !host.includes('jd.hk')) return null;

        const itemId = this.extractProductId(url);
        if (!itemId) return null;

        const canonicalHost = host.includes('jd.hk') ? 'item.jd.hk' : 'item.jd.com';
        return `https://${canonicalHost}/${itemId}.html`;
    }

    protected isProductPage(url: URL): boolean {
        const host = url.hostname.toLowerCase();
        const isItemHost = host.startsWith('item.') || host.startsWith('item-');
        return isItemHost && (host.includes('jd.com') || host.includes('jd.hk')) && !!this.extractProductId(url);
    }

    protected extractProductId(url: URL): string {
        const pathMatch = url.pathname.match(/(?:\/product\/)?(\d+)\.html/i);
        if (pathMatch && pathMatch[1]) return pathMatch[1];

        const queryCandidates = [
            url.searchParams.get('sku'),
            url.searchParams.get('skuId'),
            url.searchParams.get('id')
        ];
        for (const item of queryCandidates) {
            if (item && /^\d+$/.test(item)) return item;
        }

        return '';
    }
}

