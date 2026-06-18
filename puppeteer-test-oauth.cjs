const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();

    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));

    // Simulate a Supabase OAuth Redirect with a dummy access token format
    // We don't need a real valid JWT signature for `GoTrueClient.getSessionFromUrl` to parse it into local storage,
    // but it might fail validation later. Even if it fails validation, it should clear the hash!
    const url = 'http://localhost:3001/#access_token=dummy.jwt.format&expires_in=3600&refresh_token=dummyrefresh&token_type=bearer';

    await page.goto(url, { waitUntil: 'networkidle0' });

    // Get current URL
    const currentUrl = page.url();
    console.log('CURRENT URL AFTER LOAD:', currentUrl);

    const content = await page.content();
    console.log('PAGE HAS AUTH VIEW:', content.includes('AuthView') || content.includes('로그인 / 가입하기') || content.includes('Dayflow') ? 'YES' : 'NO');

    await browser.close();
})();
