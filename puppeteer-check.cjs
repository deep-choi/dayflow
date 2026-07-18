const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
    page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));

    await page.goto('http://localhost:3001', { waitUntil: 'networkidle0' });

    const content = await page.content();
    console.log('PAGE HAS AUTH VIEW:', content.includes('AuthView') || content.includes('로그인 / 가입하기') || content.includes('Dayflow') ? 'YES' : 'NO');
    console.log('PAGE HAS BACKGROUND DIV:', content.includes('min-h-screen bg-white') ? 'YES' : 'NO');

    await browser.close();
})();


(async () => { const browser = await require('puppeteer').launch({headless: 'new'}); const page = await browser.newPage(); await page.goto('http://localhost:3001'); await page.type('input[type=email]', 'test@example.com'); await page.type('input[type=password]', 'password'); await page.click('button[type=submit]'); await page.waitForTimeout(2000); const content = await page.content(); console.log('AFTER LOGIN REDIRECT:', content.includes('AuthView') ? 'STILL ON LOGIN' : 'LOGGED IN'); await browser.close(); })();
