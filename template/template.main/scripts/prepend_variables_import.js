const fs = require('fs');
const path = require('path');

const stylesDir = path.join(__dirname, '..', 'client', 'src', 'styles');

fs.readdir(stylesDir, (err, files) => {
  if (err) {
    console.error('Error reading styles dir:', err);
    process.exit(1);
  }
  files.forEach(file => {
    if (file.endsWith('.css') && file !== 'variables.css' && file !== 'index.css') {
      const filePath = path.join(stylesDir, file);
      let content = fs.readFileSync(filePath, 'utf8');
      if (!content.includes("@import './variables.css';") && !content.includes('@import "./variables.css";')) {
        content = `@import './variables.css';\n` + content;
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Prepended import to: ${file}`);
      }
    }
  });
});
