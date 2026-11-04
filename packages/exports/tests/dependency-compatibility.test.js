import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import ExcelJS from 'exceljs';

const require = createRequire(import.meta.url);
const excelRequire = createRequire(require.resolve('exceljs'));
const archiveRequire = createRequire(excelRequire.resolve('archiver'));
const utilsRequire = createRequire(archiveRequire.resolve('archiver-utils'));
const glob = utilsRequire('glob');
const archiver = excelRequire('archiver');
const unzipper = excelRequire('unzipper');

test('Excel archive dependencies resolve the patched minimatch implementation', () => {
  for (const dependencyRequire of [
    createRequire(utilsRequire.resolve('glob')),
    createRequire(archiveRequire.resolve('readdir-glob')),
  ]) {
    const manifest = dependencyRequire('minimatch/package.json');
    const [major, minor, patch] = manifest.version.split('.').map(Number);
    assert.ok(major > 11 || (major === 11 && (minor > 0 || patch >= 4)), manifest.version);
    assert.equal(typeof dependencyRequire('minimatch').Minimatch, 'function');
  }
});

test('patched glob matching preserves directory ZIP exports and streamed XLSX files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'woo-export-dependencies-'));
  try {
    const source = join(directory, 'source');
    await mkdir(join(source, 'nested'), { recursive: true });
    await mkdir(join(source, 'ignored'));
    for (const name of [
      'طلب 001.txt',
      'nested/002.csv',
      'nested/003.txt',
      'ignored/004.txt',
      '.hidden.txt',
    ]) {
      await writeFile(join(source, name), name);
    }
    assert.deepEqual(
      glob
        .sync('**/*.{txt,csv}', { cwd: source, nodir: true, ignore: ['ignored/**'] })
        .map((path) => path.replaceAll('\\', '/'))
        .sort(),
      ['nested/002.csv', 'nested/003.txt', 'طلب 001.txt'].sort(),
    );
    assert.deepEqual(glob.sync('missing/*.txt', { cwd: source }), []);

    const zipPath = join(directory, 'documents.zip');
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 1 } });
    archive.on('error', (error) => output.destroy(error));
    archive.pipe(output);
    const finished = once(output, 'close');
    archive.glob('**/*.{txt,csv}', { cwd: source, ignore: ['ignored/**'] });
    await archive.finalize();
    await finished;
    const zip = await unzipper.Open.file(zipPath);
    assert.deepEqual(
      zip.files.map((file) => file.path).sort(),
      ['nested/002.csv', 'nested/003.txt', 'طلب 001.txt'].sort(),
    );
    assert.equal(
      (await zip.files.find((file) => file.path === 'طلب 001.txt').buffer()).toString(),
      'طلب 001.txt',
    );

    const workbookPath = join(directory, 'orders.xlsx');
    const streamed = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: workbookPath,
      useStyles: true,
    });
    const sheet = streamed.addWorksheet('الطلبات');
    sheet.columns = [
      { header: 'الاسم بالكامل', key: 'name', width: 30 },
      { header: 'الهاتف', key: 'phone', width: 18 },
    ];
    sheet.addRow({ name: 'أحمد محمد', phone: '01055127111' }).commit();
    await streamed.commit();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await readFile(workbookPath));
    assert.equal(workbook.worksheets[0].getCell('A2').value, 'أحمد محمد');
    assert.equal(workbook.worksheets[0].getCell('B2').value, '01055127111');
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(workbookPath, {
      worksheets: 'emit',
      sharedStrings: 'cache',
      styles: 'cache',
      hyperlinks: 'ignore',
    });
    const rows = [];
    for await (const worksheet of reader) {
      for await (const row of worksheet) rows.push(row.values.slice(1));
    }
    assert.deepEqual(rows, [
      ['الاسم بالكامل', 'الهاتف'],
      ['أحمد محمد', '01055127111'],
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
