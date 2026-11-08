'use strict';
// Back-in-stock email. Table layout + inline styles so it renders in Gmail, Outlook and
// Apple Mail, and stacks cleanly on a phone.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function safeUrl(u) {
  try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
}

function formatPrice(price, currency) {
  if (price === undefined || price === null || price === '' || !Number.isFinite(Number(price))) return '';
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(Number(price)); } catch { return String(price); }
}

function formatDate(iso) {
  try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso)); } catch { return ''; }
}

function renderEmail({ request, product, config }) {
  const name = product.name || request.product_name || request.sku;
  const price = formatPrice(product.price, product.currency);
  const image = safeUrl(product.image);
  const link = safeUrl(request.source_url);
  const qty = Number(product.quantity);
  const low = qty > 0 && qty <= 5 ? `Only ${qty} left` : '';
  const brand = config.brandName;
  const asked = formatDate(request.created_at);
  const subject = `${name} is back in stock`;
  const preheader = `Good news: the item you asked about is available again${low ? `, and there are only ${qty} left` : ''}.`;

  const button = link
    ? `<tr><td class="px" style="padding:8px 32px 28px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
          <td align="center" bgcolor="#14532d" style="border-radius:10px">
            <a href="${esc(link)}" target="_blank" style="display:block;padding:15px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">Shop it now</a>
          </td></tr></table>
       </td></tr>`
    : `<tr><td class="px" style="padding:8px 32px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#3f3f46">Head back to the store to grab it before it goes again.</td></tr>`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
  @media (max-width:600px){ .container{width:100%!important} .px{padding-left:20px!important;padding-right:20px!important} .h1{font-size:24px!important;line-height:30px!important} }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f4f1;-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f1"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px">
    <tr><td class="px" style="padding:4px 32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#71717a">${esc(brand)}</td></tr>
    <tr><td bgcolor="#ffffff" style="border-radius:16px;overflow:hidden;border:1px solid #e7e5e4">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${image ? `<tr><td style="padding:0"><img src="${esc(image)}" width="560" alt="${esc(name)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:16px 16px 0 0;background:#e7e5e4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#71717a"></td></tr>` : ''}
        <tr><td class="px" style="padding:28px 32px 4px">
          <span style="display:inline-block;padding:4px 10px;border-radius:999px;background:#dcfce7;color:#14532d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase">Back in stock</span>
          ${low ? `<span style="display:inline-block;margin-left:6px;padding:4px 10px;border-radius:999px;background:#fef3c7;color:#92400e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:700">${esc(low)}</span>` : ''}
        </td></tr>
        <tr><td class="px h1" style="padding:14px 32px 6px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:26px;line-height:32px;font-weight:700;color:#18181b">${esc(name)}</td></tr>
        <tr><td class="px" style="padding:0 32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#52525b">${price ? `<strong style="color:#18181b">${esc(price)}</strong> &nbsp;·&nbsp; ` : ''}SKU ${esc(request.sku)}</td></tr>
        <tr><td class="px" style="padding:0 32px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#3f3f46">You asked us to tell you when this was available again. It is, as of right now. Popular restocks tend to go quickly.</td></tr>
        ${button}
      </table>
    </td></tr>
    <tr><td class="px" style="padding:20px 32px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#71717a">
      You're getting this because ${esc(request.email)} signed up for a restock alert${asked ? ` on ${esc(asked)}` : ''}. This is a one-time email: we won't contact you about this item again.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    `${name} is back in stock`,
    (price ? `${price} · SKU ${request.sku}` : `SKU ${request.sku}`) + (low ? ` · ${low}` : ''),
    '',
    'You asked us to tell you when this was available again. It is, as of right now.',
    link ? `Shop it now: ${link}` : 'Head back to the store to grab it before it goes again.',
    '',
    `You're getting this because ${request.email} signed up for a restock alert${asked ? ` on ${asked}` : ''}. This is a one-time email.`,
  ].join('\n');

  return { subject, html, text };
}

module.exports = { renderEmail, esc, safeUrl, formatPrice };
