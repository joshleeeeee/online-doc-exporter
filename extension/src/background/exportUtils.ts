export function sanitizeFilename(name: string): string {
    if (!name) return 'document'
    let safe = name
        .replace(/[\\/]/g, '_')
        .replace(/[<>:"|?*#%&{}$!@`+=~^]/g, '')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/^\.+/, '')
        .replace(/\s+/g, ' ')
        .trim()
    if (!safe) return 'document'
    if (safe.length > 200) safe = safe.substring(0, 200)
    return safe
}

export function normalizeExportTitle(title: string): string {
    if (!title) return ''
    return title
        .replace(/\s*[-|｜]\s*(feishu|lark)\s*docs?$/i, '')
        .replace(/\s*[-|｜]\s*飞书(云)?文档$/i, '')
        .replace(/\s*[-|｜]\s*文档$/i, '')
        .trim()
}

export function buildPrintHTML(content: string, title: string): string {
    const safeTitle = title
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${safeTitle}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Helvetica Neue',Helvetica,Arial,sans-serif;
  color:#1a1a1a;line-height:1.8;-webkit-font-smoothing:antialiased;
}
.document-body{padding:1.5cm 2cm}
.document-body h1{font-size:26px;font-weight:800;color:#111827;margin:0 0 20px 0;line-height:1.4;border-bottom:2px solid #e5e7eb;padding-bottom:10px}
.document-body h2{font-size:21px;font-weight:700;color:#1f2937;margin:28px 0 14px 0;line-height:1.4}
.document-body h3{font-size:17px;font-weight:600;color:#374151;margin:22px 0 10px 0;line-height:1.4}
.document-body p{margin:0 0 10px 0;line-height:1.8;color:#374151}
.document-body ul,.document-body ol{margin:0 0 14px 0;padding-left:24px}
.document-body li{margin-bottom:5px;line-height:1.7}
.document-body blockquote{margin:14px 0;padding:10px 18px;border-left:4px solid #6366f1;background:#f8fafc;color:#4b5563;border-radius:0 6px 6px 0}
.document-body pre{margin:14px 0;padding:14px 18px;background:#f3f4f6;color:#1e293b;border:1px solid #d1d5db;border-radius:6px;font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-wrap:break-word;overflow-x:auto}
.document-body code{font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:12px}
.document-body p code,.document-body li code{background:#f1f5f9;padding:1px 5px;border-radius:3px;color:#e11d48;font-size:0.9em}
.document-body img{max-width:100%;height:auto;border-radius:3px;margin:6px 0}
.document-body table{width:100%;border-collapse:collapse;margin:14px 0;font-size:12px}
.document-body table td,.document-body table th{border:1px solid #d1d5db;padding:6px 10px;text-align:left}
.document-body table tr:nth-child(even){background:#f9fafb}
.document-body hr{border:none;border-top:1px solid #e5e7eb;margin:20px 0}
.document-body a{color:#3b82f6;text-decoration:none}
@page{margin:0;size:A4}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  .document-body img{page-break-inside:avoid}
  .document-body h1,.document-body h2,.document-body h3{page-break-after:avoid}
  .document-body table{page-break-inside:auto}
  .document-body tr{page-break-inside:avoid}
}
</style>
</head>
<body>
<article class="document-body">
${content}
</article>
</body>
</html>`
}
