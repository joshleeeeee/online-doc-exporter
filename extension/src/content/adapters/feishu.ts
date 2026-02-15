import { BaseAdapter } from './base';

export class FeishuAdapter extends BaseAdapter {
    private normalizeScannedTitle(title: string): string {
        return title
            .trim()
            .replace(/^(shortcut|快捷方式|便捷方式)\s*[:：]\s*/i, "");
    }

    async scanLinks(): Promise<{ title: string; url: string }[]> {
        console.log('FeishuAdapter: Starting link scan...');
        const links = new Set<string>();
        const results: { title: string; url: string }[] = [];

        // --- 1. Scan Wiki sidebar tree nodes (workspace-tree-view-node) ---
        const treeNodes = document.querySelectorAll('.workspace-tree-view-node[data-node-uid]');
        console.log(`FeishuAdapter: Found ${treeNodes.length} wiki sidebar tree nodes`);

        treeNodes.forEach(node => {
            // Skip folder-type nodes: their expand arrow has --has-icon class and contains an SVG
            const expandArrow = node.querySelector('.workspace-tree-view-node-expand-arrow');
            if (expandArrow && (
                expandArrow.classList.contains('workspace-tree-view-node-expand-arrow--has-icon') ||
                expandArrow.querySelector('svg')
            )) return;

            const nodeUid = node.getAttribute('data-node-uid') || '';
            // Extract wikiToken from data-node-uid, e.g. "...&wikiToken=GGvdwRQ32icbnTkT1d3c5NrMnlZ"
            const tokenMatch = nodeUid.match(/wikiToken=([^&]+)/);
            if (!tokenMatch) return;

            const wikiToken = tokenMatch[1];
            const url = `${window.location.origin}/wiki/${wikiToken}`;

            if (links.has(url)) return;

            // Find the title from workspace-tree-view-node-content span
            const titleEl = node.querySelector('.workspace-tree-view-node-content');
            let title = '';
            if (titleEl) {
                title = titleEl.getAttribute('title') || titleEl.textContent?.trim() || '';
            }

            title = this.normalizeScannedTitle(title);
            if (!title) return;

            links.add(url);
            results.push({ title, url });
        });

        // --- 2. Scan document content links (existing logic) ---
        const selectors = [
            'a.mention-doc',
            'a.file-item-link',
            'div[role="treeitem"] a',
            'a[href*="/docs/"]',
            'a[href*="/docx/"]',
            'a[href*="/wiki/"]',
            'a[href*="/sheets/"]',
            'a[href*="/base/"]',
            'a[href*="/file/"]',
            '.table-view .workspace-dnd-source',
            '.table-view [data-obj-token]',
            // Feishu Drive folder file list items
            '[data-e2e="file-list-item"]',
            '.file-list-item',
            '.explorer-file-list [data-obj-token]',
        ];

        const nodes = document.querySelectorAll(selectors.join(', '));

        nodes.forEach(node => {
            let url: string | null = (node as any).href || null;

            if (!url) {
                const objTokenAttr = node.getAttribute('data-obj-token');
                const nodeTokenAttr = node.getAttribute('data-node-token');
                if (objTokenAttr || nodeTokenAttr) {
                    const type = node.getAttribute('data-type');
                    const typeMap: Record<string, string> = {
                        '2': 'docs', '3': 'sheets', '8': 'wiki', '15': 'base', '22': 'docx', '11': 'mindnotes'
                    };

                    const typePath = typeMap[type || ''] || (nodeTokenAttr ? 'wiki' : 'docx');
                    let token = (typePath === 'wiki') ? (nodeTokenAttr || objTokenAttr) : (objTokenAttr || nodeTokenAttr);

                    if (token) {
                        token = (token.includes(':') ? token.split(':').pop() : token) || '';
                        url = `${window.location.origin}/${typePath}/${token}`;
                    }
                }
            }

            if (!url) {
                // Try finding a doc link inside the element (e.g. Drive file-list-item)
                const docLink = node.querySelector('a[href*="/docx/"], a[href*="/docs/"], a[href*="/wiki/"], a[href*="/sheets/"], a[href*="/base/"], a[href*="/file/"]') as HTMLAnchorElement;
                if (docLink) {
                    url = docLink.href;
                } else {
                    const firstLink = node.querySelector('a[href]');
                    if (firstLink) url = (firstLink as any).href;
                }
            }

            if (!url || typeof url !== 'string') return;

            url = url.split('#')[0];

            if (links.has(url)) return;
            if (url.startsWith('http') && !url.includes('feishu.cn') && !url.includes('larksuite.com')) return;
            if (!url.match(/\/(docs|docx|wiki|sheets|base|file|drive)\//)) return;

            let title = '';
            const titleNode = node.querySelector('.workspace-dnd-node-content, .tree-node-title, .catalog-tree-node-text, .explorer-node-title, .file-item-name, [class*="fileName"]');
            if (titleNode) {
                title = titleNode.getAttribute('title') || titleNode.textContent || '';
            }
            if (!title) title = (node as any).title || '';
            if (!title && node.classList.contains('mention-doc')) title = node.textContent || '';
            // For Drive file-list-items, try to get the file name from the link text
            if (!title && (node.classList.contains('file-list-item') || node.getAttribute('data-e2e') === 'file-list-item')) {
                const nameEl = node.querySelector('[class*="file"][class*="name"], .file-item-link, a[title]') as HTMLElement;
                if (nameEl) title = nameEl.getAttribute('title') || nameEl.textContent?.trim() || '';
            }
            if (!title) title = node.textContent?.trim() || '';

            title = this.normalizeScannedTitle(title);

            if (!title) return;

            links.add(url);
            results.push({ title, url });
        });

        console.log(`FeishuAdapter: Total scanned links: ${results.length}`);
        return results;
    }

    async extract() {
        const getScrollContainer = () => {
            const candidates = [
                '.scroll-container', '.editor-wrapper', '.render-content', '.document-container',
                '#doc-body', '.ace-content-scroll-container', '.drive-scroll-container',
                '.editor-scroll', '.note-content-container'
            ];

            for (const selector of candidates) {
                const el = document.querySelector(selector) as HTMLElement;
                if (el && el.scrollHeight > el.clientHeight && el.clientHeight > 100) return el;
            }

            const contentNode = document.querySelector('[data-block-type]') ||
                document.querySelector('.ace-line') ||
                document.querySelector('.note-content');

            if (contentNode) {
                let parent = contentNode.parentElement;
                while (parent && parent !== document.body && parent !== document.documentElement) {
                    const style = window.getComputedStyle(parent);
                    const isScrollStyle = (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay');
                    if (parent.scrollHeight > parent.clientHeight && parent.clientHeight > 150) {
                        if (isScrollStyle || parent.scrollHeight > parent.clientHeight + 50) return parent;
                    }
                    parent = parent.parentElement;
                }
            }

            if (document.body.scrollHeight > document.documentElement.clientHeight &&
                window.getComputedStyle(document.body).overflowY !== 'hidden') return document.body;

            if (document.documentElement.scrollHeight > document.documentElement.clientHeight) return document.documentElement;

            return null;
        };

        const container = getScrollContainer();
        const getScrollHeight = () => container ? container.scrollHeight : document.documentElement.scrollHeight;
        const getClientHeight = () => container ? container.clientHeight : document.documentElement.clientHeight;
        const scrollTo = (y: number) => {
            if (container) container.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
            else window.scrollTo(0, y);
        };
        const getCurrentScroll = () => container ? container.scrollTop : window.scrollY;

        let totalHeight = getScrollHeight();
        const processedBlockIds = new Set<string>();
        let output = "";
        let listState: string | null = null;
        let tableBuffer: Element[] = [];

        const flushTableBuffer = async () => {
            if (tableBuffer.length > 0) {
                output += await this.processTables(tableBuffer, this.format, this.options);
                tableBuffer = [];
            }
        };

        const processBatch = async (blocks: Element[]) => {
            for (let i = 0; i < blocks.length; i++) {
                const block = blocks[i];
                let blockId = block.getAttribute('data-block-id') || block.id;

                if (!blockId) {
                    const contentSig = block.textContent?.substring(0, 20).replace(/\s/g, '') || '';
                    const type = block.getAttribute("data-block-type") || 'untyped';
                    blockId = `${type}_${contentSig}`;
                }

                if (processedBlockIds.has(blockId)) continue;
                processedBlockIds.add(blockId);

                const type = block.getAttribute("data-block-type");
                if (type === "page" || type === "table_cell") continue;
                if (block.closest('[data-block-type="table"]') && type !== "table") continue;

                if (!type && block.classList.contains("ace-line")) {
                    const parent = block.closest('[data-block-type]');
                    if (parent && parent.getAttribute('data-block-type') !== 'page') continue;
                }

                if (type === "table") {
                    tableBuffer.push(block);
                    continue;
                } else {
                    await flushTableBuffer();
                }

                if (this.format === "html") {
                    if (type === "ordered") {
                        if (listState !== "ol") {
                            if (listState === "ul") output += "</ul>";
                            output += "<ol>";
                            listState = "ol";
                        }
                    } else if (type === "bullet") {
                        if (listState !== "ul") {
                            if (listState === "ol") output += "</ol>";
                            output += "<ul>";
                            listState = "ul";
                        }
                    } else {
                        if (listState === "ol") { output += "</ol>"; listState = null; }
                        if (listState === "ul") { output += "</ul>"; listState = null; }
                    }
                }

                output += await this.getBlockContent(block, this.format, this.options);
            }
        };

        scrollTo(0);
        await new Promise(r => setTimeout(r, 600));

        let noNewContentCount = 0;
        let lastScrollTop = -1;

        while (true) {
            const blocks = Array.from(document.querySelectorAll("[data-block-type], .ace-line[data-node='true']"));
            await processBatch(blocks);
            await flushTableBuffer();

            totalHeight = getScrollHeight();
            const clientHeight = getClientHeight();
            const currentScroll = getCurrentScroll();

            if (Math.ceil(currentScroll + clientHeight) >= totalHeight - 50) {
                noNewContentCount++;
                if (noNewContentCount > 8) break;
            } else {
                noNewContentCount = 0;
            }

            const nextScroll = currentScroll + (clientHeight * 0.85);
            scrollTo(nextScroll);

            const waitTime = this.options.scrollWaitTime || 1500;
            await new Promise(r => setTimeout(r, waitTime));

            const newScroll = getCurrentScroll();
            if (Math.abs(newScroll - lastScrollTop) < 5 && lastScrollTop !== -1) {
                noNewContentCount++;
                if (noNewContentCount > 8) break;
            }
            lastScrollTop = newScroll;
        }

        await flushTableBuffer();
        if (this.format === "html" && listState) {
            output += listState === "ol" ? "</ol>" : "</ul>";
        }

        if (this.imageStats.total > 0) {
            console.log(`[ImageProcess] Completed ${this.imageStats.done}/${this.imageStats.total}, failed=${this.imageStats.failed}`);
        }

        return { content: output, images: this.images };
    }

    extractCodeBlock(block: Element) {
        let lang = "";
        const langNode = block.querySelector('.code-block-header-btn span') ||
            block.querySelector('.code-language') ||
            block.querySelector('[class*="language-"]');
        if (langNode) {
            lang = langNode.textContent?.trim().toLowerCase() || '';
            if (["plain text", "plaintext", "代码块", "copy", "复制"].includes(lang)) lang = "";
        }

        let content = "";
        const lines = Array.from(block.querySelectorAll('.ace-line'));
        if (lines.length > 0) {
            content = lines.map(line => line.textContent).join('\n');
        } else {
            const clone = block.cloneNode(true) as HTMLElement;
            clone.querySelectorAll('.code-block-header, .code-block-tool, .code-copy-btn, .code-language, [class*="header"]').forEach(el => el.remove());
            const contentNode = clone.querySelector('.code-block-content') || clone.querySelector('code') || clone;
            content = (contentNode as HTMLElement).innerText || contentNode.textContent || '';
        }

        content = content.trim();
        const linesOfContent = content.split('\n');
        if (linesOfContent.length > 0) {
            let firstLine = linesOfContent[0].trim();
            if (firstLine.startsWith("代码块")) {
                firstLine = firstLine.substring(3).trim();
                linesOfContent[0] = firstLine;
                if (!firstLine) linesOfContent.shift();
            }
            if (linesOfContent.length > 0) {
                firstLine = linesOfContent[0].trim();
                if (lang && firstLine.toLowerCase() === lang) linesOfContent.shift();
            }
            content = linesOfContent.join('\n').trim();
        }

        return { lang, content };
    }

    async getBlockContent(block: Element, format: string, options: any): Promise<string> {
        let type = block.getAttribute("data-block-type");
        if (!type && block.classList.contains("ace-line")) {
            if (block.classList.contains("gallery-line") || block.querySelector(".new-gallery")) type = "image";
            else type = "text";
        }
        const textContent = this.extractStyledText(block, format);

        if (format === "markdown") {
            switch (type) {
                case "heading1": return `# ${textContent}\n\n`;
                case "heading2": return `## ${textContent}\n\n`;
                case "heading3": return `### ${textContent}\n\n`;
                case "heading4": return `#### ${textContent}\n\n`;
                case "heading5": return `##### ${textContent}\n\n`;
                case "heading6": return `###### ${textContent}\n\n`;
                case "text": return `${textContent}\n\n`;
                case "code":
                    const codeMd = this.extractCodeBlock(block);
                    return "```" + codeMd.lang + "\n" + codeMd.content + "\n```\n\n";
                case "quote": return `> ${textContent}\n\n`;
                case "ordered": return `1. ${textContent}\n`;
                case "bullet": return `- ${textContent}\n`;
                case "todo":
                    const isChecked = block.querySelector(".todo-checkbox.checked");
                    return `- [${isChecked ? "x" : " "}] ${textContent}\n`;
                case "divider": return `---\n\n`;
                case "image":
                    const img = block.querySelector("img");
                    if (img) {
                        const src = img.getAttribute("data-src") || img.src;
                        if (src && !src.startsWith("data:image/svg")) {
                            const finalSrc = await this.processImage(src);
                            return `<img src="${finalSrc}" referrerpolicy="no-referrer" alt="Image" />\n\n`;
                        }
                    }
                    return "";
                default: return textContent + "\n\n";
            }
        } else {
            switch (type) {
                case "heading1": return `<h1>${textContent}</h1>`;
                case "heading2": return `<h2>${textContent}</h2>`;
                case "heading3": return `<h3>${textContent}</h3>`;
                case "text": return `<p>${textContent}</p>`;
                case "code":
                    const codeHtml = this.extractCodeBlock(block);
                    return `<pre><code class="language-${codeHtml.lang}">${codeHtml.content}</code></pre>`;
                case "quote": return `<blockquote>${textContent}</blockquote>`;
                case "ordered": return `<li>${textContent}</li>`;
                case "bullet": return `<li>${textContent}</li>`;
                case "todo": return `<div><input type="checkbox" ${block.querySelector(".checked") ? "checked" : ""}> ${textContent}</div>`;
                case "divider": return `<hr/>`;
                case "image":
                    const img = block.querySelector("img");
                    if (img) {
                        const src = img.getAttribute("data-src") || img.src;
                        if (src) {
                            const finalSrc = await this.processImage(src);
                            return `<img src="${finalSrc}" referrerpolicy="no-referrer" />`;
                        }
                    }
                    return "";
                default: return `<p>${textContent}</p>`;
            }
        }
    }

    extractStyledText(element: Element, format: string = "markdown"): string {
        let result = "";
        const candidates = Array.from(element.querySelectorAll('[data-string="true"], .mention-doc, .embed-inline-link'));
        const textSpans = candidates.filter((node, index, self) => !self.some((other, otherIndex) => otherIndex !== index && other.contains(node)));

        textSpans.forEach(span => {
            let text = span.textContent || '';
            let href: string | null = null;

            if (span.classList && (span.classList.contains('mention-doc') || span.classList.contains('embed-inline-link'))) {
                const anchor = (span.tagName === 'A' ? span : span.querySelector('a')) as HTMLAnchorElement;
                if (anchor) {
                    href = anchor.getAttribute('data-href') || anchor.getAttribute('href');
                    text = anchor.textContent || '';
                }
            }

            const style = span.getAttribute("style") || "";
            const classes = span.className || "";
            const isCode = classes.includes("code-inline") || style.includes("font-family:Monospace");

            if (format === "markdown") {
                const isBold = style.includes("font-weight:bold") || style.includes("font-weight: bold") || classes.includes("replace-bold");
                const isItalic = style.includes("font-style:italic") || style.includes("font-style: italic");
                const isStrike = style.includes("text-decoration:line-through") || style.includes("text-decoration: line-through");

                let chunk = text;
                if (isCode) chunk = "`" + chunk + "`";
                if (isBold) chunk = "**" + chunk + "**";
                if (isItalic) chunk = "*" + chunk + "*";
                if (isStrike) chunk = "~~" + chunk + "~~";

                if (!href) {
                    const linkWrapper = span.closest("a.link") as HTMLAnchorElement;
                    if (linkWrapper && linkWrapper.href) href = linkWrapper.href;
                }

                if (href && href.startsWith('http')) chunk = `[${chunk}](${href})`;
                result += chunk;
            } else {
                const computed = window.getComputedStyle(span);
                const isComputedBold = computed.fontWeight === "bold" || parseInt(computed.fontWeight) >= 600;
                const isComputedItalic = computed.fontStyle === "italic";
                const decoration = computed.textDecorationLine || computed.textDecoration || "";

                let chunk = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                let stylesComponents = [];
                if (isComputedBold) stylesComponents.push("font-weight: bold");
                if (isComputedItalic) stylesComponents.push("font-style: italic");
                if (decoration.includes("underline")) stylesComponents.push("text-decoration: underline");
                if (decoration.includes("line-through")) stylesComponents.push("text-decoration: line-through");

                const color = computed.color;
                if (color && color !== "rgba(0, 0, 0, 0)") stylesComponents.push(`color: ${color}`);

                if (stylesComponents.length > 0) chunk = `<span style="${stylesComponents.join("; ")}">${chunk}</span>`;

                if (!href) {
                    const linkWrapper = span.closest("a.link") as HTMLAnchorElement;
                    if (linkWrapper) href = linkWrapper.href;
                    if (span.tagName === 'A') href = (span as HTMLAnchorElement).href;
                }

                if (href) chunk = `<a href="${href}">${chunk}</a>`;
                result += chunk;
            }
        });

        return result;
    }

    async processTables(tableBlocks: Element[], format: string, options: any = {}): Promise<string> {
        let tableOut = "";
        let allRows: HTMLTableRowElement[] = [];

        tableBlocks.forEach(block => {
            const rows = Array.from(block.querySelectorAll("tr"));
            allRows = allRows.concat(rows);
        });

        if (allRows.length === 0) return "";
        const hasImages = allRows.some(row => row.querySelector("img"));
        const isFallback = format === "markdown" && hasImages;
        if (isFallback) format = "html_table_in_md";

        if (format === "markdown") {
            tableOut += "\n|";
            for (let rowIndex = 0; rowIndex < allRows.length; rowIndex++) {
                const row = allRows[rowIndex];
                const cells = row.querySelectorAll("td");
                let rowStr = "|";

                for (const cell of Array.from(cells)) {
                    let cellContent = "";
                    let images = Array.from(cell.querySelectorAll("img")).filter(img => {
                        const src = img.getAttribute("data-src") || img.src;
                        if (src && src.startsWith("data:image/svg")) return false;
                        if (img.width < 10 && img.height < 10) return false;
                        return true;
                    });

                    for (const img of images) {
                        const src = img.getAttribute("data-src") || img.src;
                        if (src) {
                            const finalSrc = await this.processImage(src);
                            cellContent += `<img src="${finalSrc}" referrerpolicy="no-referrer" style="max-width:100%;" /><br>`;
                        }
                    }

                    const text = this.extractStyledText(cell, "markdown");
                    if (text.trim()) cellContent += text.replace(/\n/g, "<br>");
                    if (cellContent.endsWith("<br>")) cellContent = cellContent.slice(0, -4);
                    rowStr += ` ${cellContent} |`;
                }
                tableOut += rowStr + "\n";
                if (rowIndex === 0) {
                    let sep = "|";
                    cells.forEach(() => sep += " --- |");
                    tableOut += sep + "\n";
                }
            }
            tableOut += "\n";
        } else {
            tableOut += '<table border="1" style="border-collapse: collapse; width: 100%;">';
            for (const row of allRows) {
                tableOut += "<tr>";
                const cells = row.querySelectorAll("td");
                for (const cell of Array.from(cells)) {
                    let cellInner = "";
                    const blocks = cell.querySelectorAll("[data-block-type]");
                    if (blocks.length > 0) {
                        for (const ib of Array.from(blocks)) cellInner += await this.getBlockContent(ib, "html", options);
                    } else {
                        cellInner = this.extractStyledText(cell, "html");
                        const images = cell.querySelectorAll("img");
                        for (const img of Array.from(images)) {
                            if (!cellInner.includes(img.src) && img.width > 20) {
                                const finalSrc = await this.processImage(img.src);
                                cellInner += `<img src="${finalSrc}" referrerpolicy="no-referrer" style="max-width:100%;" /><br>`;
                            }
                        }
                    }
                    tableOut += `<td style="border: 1px solid #ccc; padding: 5px;">${cellInner}</td>`;
                }
                tableOut += "</tr>";
            }
            tableOut += "</table>";
            if (isFallback) tableOut += "\n\n";
        }
        return tableOut;
    }
}
