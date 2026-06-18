const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
    page.on('pageerror', err => console.log('BROWSER PAGE ERROR:', err.toString()));

    const hashUrl = 'http://localhost:3001/?view=chat#access_token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInN1YiI6ImExMjM0NTY3LTg5YWItY2RlZi0wMTIzLTQ1Njc4OWFiY2RlZiIsImF1ZCI6ImF1dGhlbnRpY2F0ZWQiLCJleHAiOjI1MjQ2MDgwMDAsImlhdCI6MTY3MjUzMTIwMH0.XbH2mPZ-fR81_qF0-b_B9O8Wb-8Zk-3s2WzM8Kk3u-g&expires_in=3600&refresh_token=mock-refresh-token&token_type=bearer';

    console.log('--- NAVIGATING TO APP WITH TOKEN ---');
    await page.goto(hashUrl, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2000));

    console.log('--- REFRESHING PAGE ---');
    await page.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 2000));

    const content = await page.content();
    console.log('IS PAGE BLANK?', content.includes('id="root"></div>') && !content.includes('Dayflow') ? 'YES BLANK' : 'NO');
    console.log('IS AUTH VIEW?', content.includes('AuthView') || content.includes('로그인') ? 'YES' : 'NO');

    await browser.close();
})();
