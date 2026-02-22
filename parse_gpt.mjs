import fs from 'fs';

const html = fs.readFileSync('chatgpt.html', 'utf8');
const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s) || html.match(/window\.__remixContext = (.*?);<\/script>/s);

if (match) {
    try {
        const json = JSON.parse(match[1]);
        console.log(JSON.stringify(json, null, 2).substring(0, 1000)); // Print start to see structure
    } catch (e) {
        console.error("JSON parse error");
    }
} else {
    // Try to find raw text
    const textMatches = html.match(/"text":"(.*?)"/g);
    if (textMatches) {
        textMatches.forEach(m => console.log(m));
    } else {
        console.log("No data found");
    }
}
