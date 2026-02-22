import fs from 'fs';
const html = fs.readFileSync('chatgpt.html', 'utf8');

// Try to extract text inside paragraph or divs that might be the chat messages.
// ChatGPT message nodes often have data-message-author-role or similar classes (e.g., .markdown)
let content = '';
const textMatches = html.match(/>([^<]+)</g);
if (textMatches) {
    const textLines = textMatches.map(m => m.slice(1, -1).trim()).filter(t => t.length > 10);
    // Print lines out to see what it is
    content = textLines.join('\n');
}

fs.writeFileSync('chatgpt.txt', content);
console.log('Saved stripped text to chatgpt.txt');
