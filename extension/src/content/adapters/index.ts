import { detectPlatformByHostname } from '../../platformRegistry';
import { BaseAdapter } from './base';
import { BossZhipinAdapter } from './boss';
import { FeishuAdapter } from './feishu';
import { JdReviewAdapter } from './jd-review';
import { TaobaoReviewAdapter } from './taobao-review';

export class PlatformAdapterFactory {
    static getAdapter(format: string, options: any): BaseAdapter | null {
        const platform = detectPlatformByHostname(window.location.hostname);
        if (!platform) return null;

        switch (platform.id) {
            case 'feishu':
                return new FeishuAdapter(format, options);
            case 'boss':
                return new BossZhipinAdapter(format, options);
            case 'jd':
                return new JdReviewAdapter(format, options);
            case 'taobao':
                return new TaobaoReviewAdapter(format, options);
            default:
                return null;
        }
    }
}

export { BaseAdapter, BossZhipinAdapter, FeishuAdapter, JdReviewAdapter, TaobaoReviewAdapter };
