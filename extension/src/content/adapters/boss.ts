import { BaseAdapter } from './base';

export class BossZhipinAdapter extends BaseAdapter {
    async scanLinks(): Promise<{ title: string; url: string }[]> {
        const results: { title: string; url: string }[] = [];
        const links = new Set<string>();
        const selectors = ['.job-card-box', '.job-card-wrap', '.job-list-item', 'li[data-v-0c0e192e]'];

        document.querySelectorAll(selectors.join(', ')).forEach(card => {
            const linkNode = (card.querySelector('.job-name') || card.querySelector('a[href*="/job_detail/"]')) as HTMLAnchorElement;
            if (!linkNode) return;

            let url = linkNode.href;
            if (!url) {
                const hrefAttr = linkNode.getAttribute('href');
                if (hrefAttr) url = window.location.origin + hrefAttr;
            }

            if (!url) return;
            url = url.split('?')[0].split('#')[0];
            if (url.startsWith('/')) url = window.location.origin + url;

            if (links.has(url)) return;
            links.add(url);

            const jobName = linkNode.textContent?.trim() || '';
            const salary = card.querySelector('.job-salary')?.textContent?.trim() || '';
            const tags = Array.from(card.querySelectorAll('.tag-list li, .job-labels li')).map(li => li.textContent?.trim()).join('|');
            const company = card.querySelector('.boss-name, .company-name')?.textContent?.trim() || '';
            const location = card.querySelector('.company-location, .job-area')?.textContent?.trim() || '';

            const title = `${jobName} [${salary}] [${tags}] - ${company} (${location})`.trim();
            results.push({ title, url });
        });

        return results;
    }

    async extract() {
        const extractText = (sList: string[]) => {
            for (const s of sList) {
                const el = document.querySelector(s);
                if (el) {
                    if (s.includes('company-info a') && el.getAttribute('title')) return el.getAttribute('title')?.trim() || '';
                    let text = el.textContent?.trim() || '';
                    if (s.includes('boss-info-attr') && text.includes('·')) return text.split('·')[0].trim();
                    return text;
                }
            }
            return '';
        };

        const jobTitle = extractText(['.job-banner .name h1', '.name h1', 'h1']) || document.title.split('_')[0];
        const salary = extractText(['.job-banner .salary', '.salary']);
        const company = extractText(['.sider-company .company-info a', '.company-info .name', '.sider-company .name']);
        const location = extractText(['.location-address', '.job-location .text']);
        const experience = extractText(['.text-experience', '.text-experiece']);
        const degree = extractText(['.text-degree']);

        let descHtml = '';
        const descEl = document.querySelector('.job-sec-text, .job-detail .text, .detail-content');
        if (descEl) {
            const clone = descEl.cloneNode(true) as HTMLElement;
            clone.querySelectorAll('span, i, em, b').forEach(n => {
                if (n.textContent?.includes('BOSS直聘') || n.textContent === '直聘') n.remove();
            });
            descHtml = clone.innerHTML;
        }

        let output = "";
        if (this.format === "markdown") {
            output = `# ${jobTitle}\n\n`;
            if (salary) output += `**薪资**: ${salary}\n`;
            if (company) output += `**公司**: ${company}\n`;
            if (location) output += `**地点**: ${location}\n`;
            if (experience || degree) output += `**要求**: ${experience}${experience && degree ? ' / ' : ''}${degree}\n`;
            output += `**原链接**: ${window.location.href.split('?')[0]}\n\n## 职位描述\n\n${this.getSimpleMarkdown(descHtml)}\n\n`;
        } else {
            output = `<h1>${jobTitle}</h1>`;
            if (salary) output += `<p><strong>薪资</strong>: ${salary}</p>`;
            if (company) output += `<p><strong>公司</strong>: ${company}</p>`;
            if (location) output += `<p><strong>地点</strong>: ${location}</p>`;
            if (experience || degree) output += `<p><strong>要求</strong>: ${experience}${experience && degree ? ' / ' : ''}${degree}</p>`;
            output += `<p><strong>原链接</strong>: <a href="${window.location.href}">${window.location.href.split('?')[0]}</a></p><h2>职位描述</h2><div>${descHtml}</div>`;
        }

        return { content: output, images: [] };
    }

    getSimpleMarkdown(html: string): string {
        if (!html) return "";
        let md = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<li[^>]*>/gi, '- ').replace(/<\/li>/gi, '\n').replace(/<[^>]+>/g, '');
        const doc = new DOMParser().parseFromString(md, 'text/html');
        md = doc.documentElement.textContent || '';
        return md.replace(/\n{3,}/g, '\n\n').trim();
    }
}
