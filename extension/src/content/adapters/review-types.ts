export interface ReviewItem {
    user: string;
    time: string;
    sku: string;
    rating: number | null;
    content: string;
    images: string[];
}

export interface ReviewFilterOptions {
    minRating: number;
    withImagesOnly: boolean;
    maxCount: number;
    recentDays: number;
}

export interface CommerceReviewAdapterConfig {
    platformKey: 'jd' | 'taobao';
    platformLabel: string;
    scanLinkSelectors: string[];
    productTitleSelectors: string[];
    reviewNodeSelectors: string[];
    reviewContentSelectors: string[];
    reviewUserSelectors: string[];
    reviewTimeSelectors: string[];
    reviewSkuSelectors: string[];
    reviewRatingSelectors: string[];
    reviewNextPageSelectors: string[];
    titleSuffixPattern?: RegExp;
}
