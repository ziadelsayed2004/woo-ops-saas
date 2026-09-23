import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const sourceDir = path.join(root, 'apps', 'web', 'src');
const files = fs
  .readdirSync(sourceDir)
  .filter((name) => name.endsWith('.tsx'))
  .sort();
const muiSystemProps = new Set([
  'sx',
  'style',
  'alignContent',
  'alignItems',
  'alignSelf',
  'bgcolor',
  'border',
  'borderColor',
  'borderRadius',
  'bottom',
  'boxSizing',
  'display',
  'flex',
  'flexBasis',
  'flexDirection',
  'flexGrow',
  'flexShrink',
  'flexWrap',
  'fontWeight',
  'gap',
  'height',
  'justifyContent',
  'justifyItems',
  'justifySelf',
  'left',
  'lineHeight',
  'm',
  'margin',
  'maxHeight',
  'maxWidth',
  'mb',
  'minHeight',
  'minWidth',
  'ml',
  'mr',
  'mt',
  'mx',
  'my',
  'noWrap',
  'overflow',
  'overflowX',
  'overflowY',
  'p',
  'padding',
  'pb',
  'pl',
  'pr',
  'pt',
  'px',
  'py',
  'right',
  'textAlign',
  'textOverflow',
  'top',
  'width',
  'zIndex',
]);
const muiElements = new Set([
  'Alert',
  'AppBar',
  'Avatar',
  'Box',
  'Button',
  'Card',
  'CardContent',
  'Checkbox',
  'Chip',
  'CircularProgress',
  'Dialog',
  'DialogActions',
  'DialogContent',
  'DialogTitle',
  'Divider',
  'Drawer',
  'FormControl',
  'IconButton',
  'LinearProgress',
  'List',
  'ListItem',
  'ListItemButton',
  'ListItemIcon',
  'ListItemText',
  'MenuItem',
  'Paper',
  'Select',
  'Stack',
  'Tab',
  'Table',
  'TableBody',
  'TableCell',
  'TableContainer',
  'TableHead',
  'TableRow',
  'Tabs',
  'TextField',
  'Toolbar',
  'Tooltip',
  'Typography',
]);

const failures = [];
const isSemanticMuiAttribute = (tag, name, attribute) =>
  tag === 'TableCell' &&
  name === 'padding' &&
  attribute.initializer &&
  ts.isStringLiteral(attribute.initializer) &&
  ['checkbox', 'none', 'normal'].includes(attribute.initializer.text);

for (const file of files) {
  const base = path.basename(file, '.tsx');
  const cssName = `${base}.css`;
  const cssPath = path.join(sourceDir, cssName);
  const filePath = path.join(sourceDir, file);
  const source = fs.readFileSync(filePath, 'utf8');
  if (!fs.existsSync(cssPath)) failures.push(`${file}: missing colocated ${cssName}`);
  if (!source.includes(`import './${cssName}';`))
    failures.push(`${file}: missing ${cssName} import`);
  if (source.includes('styleOverrides'))
    failures.push(`${file}: contains CSS-in-JS styleOverrides`);
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sourceFile);
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.text;
        if (
          name === 'sx' ||
          name === 'style' ||
          (muiElements.has(tag) &&
            muiSystemProps.has(name) &&
            !isSemanticMuiAttribute(tag, name, attribute))
        ) {
          const position = sourceFile.getLineAndCharacterOfPosition(attribute.getStart(sourceFile));
          failures.push(`${file}:${position.line + 1}: inline presentation attribute ${name}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

if (failures.length) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Web style contract passed for ${files.length} TSX files.\n`);
}
