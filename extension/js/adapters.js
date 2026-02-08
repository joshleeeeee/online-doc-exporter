class PlatformAdapterFactory {
    static getAdapter(format, options) {
        // Simple logic for now
        const hostname = window.location.hostname;
        if (hostname.includes("feishu.cn") || hostname.includes("larksuite.com")) {
            return new FeishuAdapter(format, options);
            // More platforms can be added here
            // case 'dingtalk.com': return DingTalkAdapter(format, options);
        }
        return null;
    }
}

class BaseAdapter {
    constructor(format, options = {}) {
        this.format = format;
        this.options = options;
        this.images = []; // Store images for local zip mode
    }

    /**
     * @returns {Promise<string>} The parsed content.
     */
    async extract() {
        throw new Error("Method not implemented.");
    }

    /**
     * Handles images with base64 conversion if needed.
     * @param {string} src - Image source.
     * @returns {Promise<string>} The converted source or original.
     */
    async processImage(src) {
        if (!src) return '';

        const mode = this.options.imageMode || 'original';

        // 1. Upload to OSS/MinIO
        if (mode === 'minio' && this.options.imageConfig && this.options.imageConfig.enabled) {
            try {
                let blob;
                // Handle Data URI
                if (src.startsWith('data:')) {
                    const res = await fetch(src);
                    blob = await res.blob();
                } else {
                    // Handle Remote URL
                    blob = await ImageUtils.fetchBlob(src);
                }

                // Generate filename
                const ext = blob.type.split('/')[1] || 'png';
                const filename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;

                const newUrl = await ImageUploader.upload(blob, filename, this.options.imageConfig);
                return newUrl;
            } catch (e) {
                console.error("Upload failed, falling back to original/base64", e);
                // Fallback continues below
            }
        }

        // 2. Base64
        if (mode === 'base64' && !src.startsWith("data:")) {
            return await ImageUtils.urlToBase64(src);
        }

        // 3. Local (ZIP)
        if (mode === 'local') {
            try {
                // Determine blob
                let blob;
                if (src.startsWith('data:')) {
                    const res = await fetch(src);
                    blob = await res.blob();
                } else {
                    blob = await ImageUtils.fetchBlob(src);
                }

                const ext = blob.type.split('/')[1] || 'png';
                const filename = `image_${this.images.length + 1}_${Date.now().toString().slice(-4)}.${ext}`;

                // Convert to Base64 for transfer to popup
                const reader = new FileReader();
                const base64 = await new Promise((resolve) => {
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });

                this.images.push({
                    filename: filename,
                    base64: base64
                });

                return `images/${filename}`;
            } catch (e) {
                console.warn("Local image fetch failed", e);
                return src; // Fallback to original
            }
        }

        return src;
    }
}

class FeishuAdapter extends BaseAdapter {
    async scanLinks() {
        console.log('FeishuAdapter: Starting link scan...');
        const links = new Set();
        const results = [];

        // Selectors for Feishu sidebar / tree navigation / file lists
        const selectors = [
            '.navigation-tree a',
            '.tree-node-content a',
            '.catalog-tree a',
            '.explorer-tree a',
            'a.mention-doc', // Mentions
            'a.file-item-link', // File List Items (Explorer)
            'div[role="treeitem"] a', // Generic tree items
            'a[href*="/docs/"]',
            'a[href*="/docx/"]',
            'a[href*="/wiki/"]',
            'a[href*="/sheets/"]',
            'a[href*="/base/"]',
            'a[href*="/file/"]'
        ];

        const nodes = document.querySelectorAll(selectors.join(', '));
        console.log(`FeishuAdapter: Found ${nodes.length} potential nodes.`);

        nodes.forEach(a => {
            let url = a.href;
            // Some nodes might be wrappers, check closest 'a' if node is not 'a' (query selector might return a if specified)
            // But querySelectorAll won't unless selector targets it.
            // Check if 'a' is valid
            if (!url || typeof url !== 'string') {
                console.log(`Skipping node (invalid URL): ${a.outerHTML}`);
                return;
            }

            // Normalize URL (remove hash/query if needed, or keep?)
            url = url.split('#')[0];

            if (links.has(url)) {
                console.log(`Skipping duplicate URL: ${url}`);
                return;
            }

            // Check domain (if absolute)
            if (url.startsWith('http')) {
                if (!url.includes('feishu.cn') && !url.includes('larksuite.com')) {
                    console.log(`Skipping external domain: ${url}`);
                    return;
                }
            }

            // Check type (docs, docx, wiki)
            if (!url.match(/\/(docs|docx|wiki|sheets|base|file)\//)) {
                console.log(`Skipping non-doc type: ${url}`);
                return;
            }

            // --- Title Extraction ---
            let title = '';

            // 1. Try specific title classes found in Feishu UI
            const titleNode = a.querySelector('.workspace-dnd-node-content, .tree-node-title, .catalog-tree-node-text, .explorer-node-title');
            if (titleNode) {
                title = titleNode.getAttribute('title') || titleNode.textContent;
            }

            // 2. Try generic link title
            if (!title) title = a.title;

            // 3. Try mention text
            if (!title && a.classList.contains('mention-doc')) {
                title = a.textContent; // Mentions usually are just text
            }

            // 4. Fallback to clean innerText (heavy)
            if (!title) {
                // Clone and remove metadata or just take text
                // Feishu file links often have Date/Owner as children too.
                // We want the primary text.
                // Heuristic: Take the text of the first major div or span?
                // Or just all text.
                title = a.textContent.trim();
            }

            title = title.trim();
            // Remove common Feishu prefixes for shortcuts
            title = title.replace(/^(快捷方式|便捷方式)[:：]\s*/, "");

            if (!title) {
                console.log(`Skipping empty title for URL: ${url}`);
                return;
            }

            links.add(url);
            results.push({ title, url });
            console.log(`Found: [${title}](${url})`);
        });

        console.log(`FeishuAdapter: Scan complete. Found ${results.length} unique links.`);
        return results;
    }

    async extract() {
        // Helper to find the real scrollable container
        const getScrollContainer = () => {
            // 1. Priority: Specific Feishu containers (Old & New)
            // Added more selectors for "Old" versions and different app modes
            const candidates = [
                '.scroll-container',
                '.editor-wrapper',
                '.render-content',
                '.document-container',
                '#doc-body',
                '.ace-content-scroll-container',
                '.drive-scroll-container',
                '.editor-scroll',
                '.note-content-container'
            ];

            for (const selector of candidates) {
                const el = document.querySelector(selector);
                // Must have scrollable content space and be visible
                if (el && el.scrollHeight > el.clientHeight && el.clientHeight > 100) {
                    return el;
                }
            }

            // 2. Generic Heuristic: Traverse up from content
            // Support both old (data-block-type) and new (.ace-line) markers
            const contentNode = document.querySelector('[data-block-type]') ||
                document.querySelector('.ace-line') ||
                document.querySelector('.note-content');

            if (contentNode) {
                let parent = contentNode.parentElement;
                while (parent && parent !== document.body && parent !== document.documentElement) {
                    const style = window.getComputedStyle(parent);
                    // Check for standard scroll properties or "overlay" which is sometimes used
                    const isScrollStyle = (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay');
                    const hasScrollSpace = parent.scrollHeight > parent.clientHeight; // Significant scroll diff

                    if (hasScrollSpace && parent.clientHeight > 150) {
                        // If explicitly scrollable or just looks like the main container
                        if (isScrollStyle || parent.scrollHeight > parent.clientHeight + 50) {
                            return parent;
                        }
                    }
                    parent = parent.parentElement;
                }
            }

            // 3. Check Body/HTML specifically for window-level scroll
            // Sometimes body has overflow:auto and handles scroll instead of window
            if (document.body.scrollHeight > document.documentElement.clientHeight &&
                window.getComputedStyle(document.body).overflowY !== 'hidden') {
                return document.body;
            }

            if (document.documentElement.scrollHeight > document.documentElement.clientHeight) {
                return document.documentElement; // Effectively window scroll
            }

            return null; // Fallback to window
        };

        const container = getScrollContainer();
        console.log('FeishuAdapter: Scroll container found:', container);

        // Abstract scroll functions
        const getScrollHeight = () => container ? container.scrollHeight : document.documentElement.scrollHeight;
        const getClientHeight = () => container ? container.clientHeight : document.documentElement.clientHeight;
        const scrollTo = (y) => {
            if (container) {
                container.scrollTo({ top: y, behavior: 'instant' }); // Use instant to avoid smooth scroll delays
            } else {
                window.scrollTo(0, y);
            }
        };
        const getCurrentScroll = () => container ? container.scrollTop : window.scrollY;

        let currentScroll = 0;
        let totalHeight = getScrollHeight();
        const processedBlockIds = new Set();
        let output = "";
        let listState = null;
        let tableBuffer = [];

        // Helper to flush table buffer
        const flushTableBuffer = async () => {
            if (tableBuffer.length > 0) {
                output += await this.processTables(tableBuffer, this.format, this.options);
                tableBuffer = [];
            }
        };

        // Helper to process a batch of blocks
        const processBatch = async (blocks) => {
            for (let i = 0; i < blocks.length; i++) {
                const block = blocks[i];

                // Unique ID check
                // Try data-block-id first, then id, then fallback
                let blockId = block.getAttribute('data-block-id') || block.id;

                if (!blockId) {
                    // Fallback for blocks without IDs (common in some rich text parts)
                    // We construct a signature: type + content(trimmed) + index-in-parent
                    // This is risky but better than nothing
                    const contentSig = block.textContent.substring(0, 20).replace(/\s/g, '');
                    const type = block.getAttribute("data-block-type");
                    blockId = `${type}_${contentSig}`;
                }

                if (processedBlockIds.has(blockId)) {
                    continue;
                }
                processedBlockIds.add(blockId);

                const type = block.getAttribute("data-block-type");

                // Skip hidden/container/irrelevant types
                if (type === "page" || type === "table_cell") continue;
                // Skip blocks inside tables (handled by table processor)
                if (block.closest('[data-block-type="table"]') && type !== "table") continue;

                // Prevent duplicates: Skip untyped ace-lines that are children of other typed blocks (Quote, Code, etc.)
                // These are effectively "inner" blocks that the parent block's renderer already handles.
                if (!type && block.classList.contains("ace-line")) {
                    const parent = block.closest('[data-block-type]');
                    if (parent && parent.getAttribute('data-block-type') !== 'page') {
                        // console.log(`Skipping inner block ${blockId} because parent ${parent.getAttribute('data-block-type')} handles it.`);
                        continue;
                    }
                }

                if (type === "table") {
                    tableBuffer.push(block);
                    continue;
                } else {
                    await flushTableBuffer();
                }

                // List Handling
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

        // Scroll Loop
        scrollTo(0);
        await new Promise(r => setTimeout(r, 600));

        let noNewContentCount = 0;
        let lastScrollTop = -1;

        while (true) {
            // 1. Get current blocks
            const blocks = Array.from(document.querySelectorAll("[data-block-type], .ace-line[data-node='true']"));

            // 2. Process them
            await processBatch(blocks);
            await flushTableBuffer();

            // 3. Update Dimensions
            totalHeight = getScrollHeight();
            const clientHeight = getClientHeight();
            currentScroll = getCurrentScroll();

            // 4. Scroll Logic
            // If we are already at bottom
            if (Math.ceil(currentScroll + clientHeight) >= totalHeight - 50) {
                // Check if height expanded (lazy load finished?)
                // If total height didn't grow and we are at bottom, we are done
                noNewContentCount++;
                // Increase retry count to handle slow loading
                if (noNewContentCount > 8) break;
            } else {
                noNewContentCount = 0;
            }

            // Scroll down
            const nextScroll = currentScroll + (clientHeight * 0.85);
            scrollTo(nextScroll);

            // 5. Wait for scroll/load
            const waitTime = this.options.scrollWaitTime || 1500;
            await new Promise(r => setTimeout(r, waitTime));

            // Check if we actually moved (if scroll stuck, we hit bottom)
            const newScroll = getCurrentScroll();
            if (Math.abs(newScroll - lastScrollTop) < 5 && lastScrollTop !== -1) {
                // We tried to scroll but position didn't change -> We are likely at bottom
                // But double check against height (sometimes height grows but scroll stays?)
                // Just break if stuck
                noNewContentCount++;
                if (noNewContentCount > 8) break;
            }
            lastScrollTop = newScroll;
        }

        // Final cleanup
        await flushTableBuffer();
        if (this.format === "html" && listState) {
            output += listState === "ol" ? "</ol>" : "</ul>";
        }

        if (output.length === 0) {
            console.warn("No content blocks found even after scroll");
        }

        return {
            content: output,
            images: this.images
        };
    }

    extractCodeBlock(block) {
        // 1. Extract Language
        let lang = "";
        const langNode = block.querySelector('.code-block-header-btn span') ||
            block.querySelector('.code-language') ||
            block.querySelector('[class*="language-"]');
        if (langNode) {
            lang = langNode.textContent.trim().toLowerCase();
            // Clean up common UI labels from language
            if (["plain text", "plaintext", "代码块", "copy", "复制"].includes(lang)) {
                lang = "";
            }
        }

        // 2. Extract Content safely
        let content = "";

        // Strategy A: If we have clean .ace-line elements, strictly use them.
        const lines = Array.from(block.querySelectorAll('.ace-line'));
        if (lines.length > 0) {
            content = lines.map(line => line.textContent).join('\n');
        } else {
            // Strategy B: Fallback
            const clone = block.cloneNode(true);
            const artifacts = clone.querySelectorAll(
                '.code-block-header, .code-block-tool, .code-copy-btn, .code-language, [class*="header"]'
            );
            artifacts.forEach(el => el.remove());
            const contentNode = clone.querySelector('.code-block-content') || clone.querySelector('code') || clone;
            content = contentNode.innerText || contentNode.textContent;
        }

        content = content.trim();

        // 3. Final cleanup - Aggressive validtion against UI text leaks
        const linesOfContent = content.split('\n');
        if (linesOfContent.length > 0) {
            // Check first line specifically
            let firstLine = linesOfContent[0].trim();

            // Remove "代码块" prefix if present (e.g. "代码块\nfunction...")
            if (firstLine.startsWith("代码块")) {
                firstLine = firstLine.substring(3).trim();
                linesOfContent[0] = firstLine; // Update first line

                // If first line is now empty, remove it entirely
                if (!firstLine) {
                    linesOfContent.shift();
                }
            }

            // Re-check first line after update
            if (linesOfContent.length > 0) {
                firstLine = linesOfContent[0].trim();
                // Check for Language Name leak (e.g. "Plain Text\nfunction...")
                if (lang && firstLine.toLowerCase() === lang) {
                    linesOfContent.shift();
                }
            }

            content = linesOfContent.join('\n').trim();
        }

        return { lang, content };
    }

    async getBlockContent(block, format, options) {
        let type = block.getAttribute("data-block-type");
        if (!type && block.classList.contains("ace-line")) {
            if (block.classList.contains("gallery-line") || block.querySelector(".new-gallery")) {
                type = "image";
            } else {
                type = "text";
            }
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
                case "heading7": return `####### ${textContent}\n\n`;
                case "heading8": return `######## ${textContent}\n\n`;
                case "heading9": return `######### ${textContent}\n\n`;
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
            // HTML
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

    extractStyledText(element, format = "markdown") {
        let result = "";
        // Select both regular text spans and mention/link widgets that aren't standard text
        // Use a set to deduplicate if hierarchy overlaps (though usually they are siblings in ace-line)
        // Updated selector to support ace-line blocks directly (referencing descendants without .ace-line prefix constraint)
        const candidates = Array.from(element.querySelectorAll('[data-string="true"], .mention-doc, .embed-inline-link'));

        // Filter out candidates that are inside other candidates to avoid double counting
        // (e.g. if we selected parent and child)
        const textSpans = candidates.filter((node, index, self) => {
            // Check if this node is contained within any OTHER node in the list
            return !self.some((other, otherIndex) => otherIndex !== index && other.contains(node));
        });

        if (textSpans.length === 0 && element.textContent.trim().length > 0) {
            // Fallback: if no structured spans found but block has text (headers often simple)
            // But usually headers also have [data-string] or similar structure in Feishu.
            // If completely empty, return empty.
            // result = element.textContent.trim(); // Risky?
        }

        textSpans.forEach(span => {
            let text = span.textContent;
            let href = null;

            // Check if it's a mention/doc link
            if (span.classList && (span.classList.contains('mention-doc') || span.classList.contains('embed-inline-link'))) {
                const anchor = span.tagName === 'A' ? span : span.querySelector('a');
                if (anchor) {
                    href = anchor.getAttribute('data-href') || anchor.getAttribute('href');
                    text = anchor.textContent; // clean text
                }
            }

            // Normal text processing
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

                // Check for wrapping link (for normal text spans)
                if (!href) {
                    const linkWrapper = span.closest("a.link");
                    if (linkWrapper && linkWrapper.href) {
                        href = linkWrapper.href;
                    }
                }

                if (href) {
                    // Clean href
                    if (href.startsWith('http')) {
                        chunk = `[${chunk}](${href})`;
                    }
                }

                result += chunk;
            } else {
                // HTML logic
                // ... (simplified for brevity, similar structure)
                // Reuse existing HTML logic structure but handle href

                const computed = window.getComputedStyle(span);
                // ... standard styles ...
                // Re-implementing simplified style extraction for the fix context
                const isComputedBold = computed.fontWeight === "bold" || parseInt(computed.fontWeight) >= 600;
                const isComputedItalic = computed.fontStyle === "italic";
                const decoration = computed.textDecorationLine || computed.textDecoration || "";

                let chunk = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

                let stylesComponents = [];
                if (isComputedBold) stylesComponents.push("font-weight: bold");
                if (isComputedItalic) stylesComponents.push("font-style: italic");
                if (decoration.includes("underline")) stylesComponents.push("text-decoration: underline");
                if (decoration.includes("line-through")) stylesComponents.push("text-decoration: line-through");

                // Colors
                const color = computed.color;
                if (color && color !== "rgba(0, 0, 0, 0)") stylesComponents.push(`color: ${color}`);

                if (stylesComponents.length > 0) {
                    chunk = `<span style="${stylesComponents.join("; ")}">${chunk}</span>`;
                }

                if (!href) {
                    const linkWrapper = span.closest("a.link");
                    if (linkWrapper) href = linkWrapper.href;
                    if (span.tagName === 'A') href = span.href; // if span is actually A
                }

                if (href) {
                    chunk = `<a href="${href}">${chunk}</a>`;
                }

                result += chunk;
            }
        });

        return result;
    }


    async processTables(tableBlocks, format, options = {}) {
        let tableOut = "";
        let allRows = [];

        tableBlocks.forEach(block => {
            const rows = Array.from(block.querySelectorAll("tr"));
            allRows = allRows.concat(rows);
        });

        if (allRows.length === 0) return "";

        const hasImages = allRows.some(row => row.querySelector("img"));

        if (format === "markdown" && hasImages) {
            format = "html_table_in_md";
        }

        if (format === "markdown") {
            tableOut += "\n|";
            for (let rowIndex = 0; rowIndex < allRows.length; rowIndex++) {
                const row = allRows[rowIndex];
                const cells = row.querySelectorAll("td");
                let rowStr = "|";

                for (const cell of cells) {
                    let cellContent = "";
                    let images = Array.from(cell.querySelectorAll("img"));

                    images = images.filter(img => {
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
                    if (text.trim()) {
                        cellContent += text.replace(/\n/g, "<br>");
                    }

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
            const isFallback = format === "html_table_in_md";
            tableOut += '<table border="1" style="border-collapse: collapse; width: 100%;">';
            for (const row of allRows) {
                tableOut += "<tr>";
                const cells = row.querySelectorAll("td");

                for (const cell of cells) {
                    let cellInner = "";
                    const blocks = cell.querySelectorAll("[data-block-type]");

                    if (blocks.length > 0) {
                        for (const ib of blocks) {
                            cellInner += await this.getBlockContent(ib, "html", options);
                        }
                    } else {
                        cellInner = this.extractStyledText(cell, "html");
                        const images = cell.querySelectorAll("img");
                        for (const img of images) {
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
