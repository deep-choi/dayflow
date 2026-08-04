const fs = require('fs');
const path = require('path');

const files = [
    'App.tsx',
    'views/AuthView.tsx',
    'views/BoardView.tsx',
    'views/CalendarView.tsx',
    'views/ChatView.tsx',
    'views/CommunityBoardView.tsx',
    'views/JournalView.tsx',
    'views/LandingView.tsx',
    'views/TodoView.tsx'
];

files.forEach(file => {
    const fullPath = path.join(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath);
        if (content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) {
            console.log(`Removing BOM from ${file}`);
            fs.writeFileSync(fullPath, content.slice(3));
        } else {
            console.log(`${file} does not have BOM`);
        }
    } else {
        console.warn(`${file} not found`);
    }
});
