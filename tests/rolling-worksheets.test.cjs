const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const elements = new Map();
const groups = new Map();
const downloads = [];
const blobs = new Map();
const alerts = [];

function element(attributes = {}) {
  return {
    style: {}, innerHTML: '', textContent: '', listeners: {}, attributes: {},
    addEventListener(type, callback) { this.listeners[type] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
    ...attributes,
  };
}

for (const tag of html.matchAll(/<[^!][^>]*>/g)) {
  const id = tag[0].match(/\bid="([^"]+)"/);
  if (id) {
    assert(!elements.has(id[1]), `Duplicate ID: ${id[1]}`);
    elements.set(id[1], element({ hidden: /\bhidden\b/.test(tag[0]) }));
  }
  const name = tag[0].match(/\bname="([^"]+)"/);
  if (!tag[0].startsWith('<input') || !name) continue;
  const radios = groups.get(name[1]) || [];
  radios.push(element({
    value: tag[0].match(/\bvalue="([^"]+)"/)[1],
    checked: /\bchecked\b/.test(tag[0]),
  }));
  groups.set(name[1], radios);
}

// Only the DOM surfaces used by this standalone page are needed for these checks.
const document = {
  getElementById(id) {
    assert(elements.has(id), `Missing page element: ${id}`);
    return elements.get(id);
  },
  querySelectorAll(selector) {
    const name = selector.match(/name="([^"]+)"/)[1];
    assert(groups.has(name), `Missing radio group: ${name}`);
    return groups.get(name);
  },
  querySelector(selector) {
    return this.querySelectorAll(selector).find((radio) => radio.checked);
  },
  body: { appendChild() {} },
  createElement(tag) {
    assert.equal(tag, 'a');
    return {
      click() { downloads.push({ name: this.download, blob: blobs.get(this.href) }); },
      remove() {},
    };
  },
};

const context = vm.createContext({
  document, Blob, TextEncoder,
  Math: Object.create(Math),
  console: { error() {} },
  alert(message) { alerts.push(message); },
  setTimeout() {},
  URL: {
    createObjectURL(blob) {
      const url = `blob:test-${blobs.size}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL() {},
  },
});
vm.runInContext(script, context);

function selectOperation(value) {
  const radios = groups.get('rollingOperationChoice');
  radios.forEach((radio) => { radio.checked = radio.value === value; });
  radios.find((radio) => radio.checked).listeners.change();
}

function checkProblems(number, operation = '+') {
  const problems = JSON.parse(JSON.stringify(context.getRollingFactProblems(number, operation)));
  assert.equal(problems.length, 100);
  const row = (index) => problems.slice(index * 10, index * 10 + 10);
  const practiceRows = [
    [0, [1, 1, 2, 1, 2, 2, 3, 2, 3, 3]],
    [1, [2, 2, 3, 2, 3, 3, 4, 3, 4, 4]],
    [3, [3, 3, 4, 3, 4, 4, 5, 4, 5, 5]],
    [4, [5, 5, 6, 5, 6, 6, 7, 6, 7, 7]],
    [6, [7, 7, 8, 7, 8, 8, 9, 8, 9, 9]],
    [7, [8, 8, 9, 8, 9, 9, 8, 9, 8, 9]],
  ];
  for (const [index, values] of practiceRows) {
    assert.deepEqual(row(index), values.map((bottom) => ({ top: number, bottom })));
  }
  assert(problems.slice(0, 80).every(({ top }) => top === number));
  for (const [index, maximum] of [[2, 4], [5, 7], [8, 9], [9, 9]]) {
    const values = row(index).map(({ top, bottom }) => {
      assert(top === number || bottom === number);
      return top === number ? bottom : top;
    });
    assert.deepEqual([...new Set(values)].sort((a, b) => a - b),
      Array.from({ length: maximum }, (_, i) => i + 1));
    const counts = Array.from({ length: maximum }, (_, i) =>
      values.filter((value) => value === i + 1).length);
    assert(Math.max(...counts) - Math.min(...counts) <= 1);
  }
  for (const index of [8, 9]) {
    assert(row(index).some(({ top, bottom }) => top === number && bottom !== number));
    assert(row(index).some(({ top, bottom }) => bottom === number && top !== number));
  }
  return problems;
}

function checkInverseProblems(number, operation) {
  assert(['-', '/'].includes(operation));
  const isDivision = operation === '/';
  const problems = JSON.parse(JSON.stringify(context.getRollingFactProblems(number, operation)));
  assert.equal(problems.length, 100);
  const row = (index) => problems.slice(index * 10, index * 10 + 10);
  const getAnswer = ({ top, bottom }) => isDivision ? top / bottom : top - bottom;
  for (const { top, bottom } of problems) {
    assert.equal(bottom, number, 'The selected subtrahend or divisor must remain fixed');
    assert(bottom > 0, 'Never divide by zero');
    const answer = getAnswer({ top, bottom });
    assert(Number.isInteger(answer), 'Every answer must be a whole number');
    assert(answer >= 0 && answer <= 9, 'Answers must be from 0 through 9');
  }
  for (const [index, answers] of [
    [0, [1, 1, 2, 1, 2, 2, 3, 2, 3, 3]],
    [1, [2, 2, 3, 2, 3, 3, 4, 3, 4, 4]],
    [3, [3, 3, 4, 3, 4, 4, 5, 4, 5, 5]],
    [4, [5, 5, 6, 5, 6, 6, 7, 6, 7, 7]],
    [6, [7, 7, 8, 7, 8, 8, 9, 8, 9, 9]],
    [7, [8, 8, 9, 8, 9, 9, 8, 9, 8, 9]],
  ]) {
    assert.deepEqual(row(index), answers.map((answer) => ({
      top: isDivision ? number * answer : number + answer, bottom: number,
    })));
  }
  for (const [index, maximum] of [[2, 4], [5, 7], [8, 9], [9, 9]]) {
    const answers = row(index).map(getAnswer);
    assert.deepEqual([...new Set(answers)].sort((a, b) => a - b),
      Array.from({ length: maximum + 1 }, (_, i) => i));
    const counts = Array.from({ length: maximum + 1 }, (_, i) =>
      answers.filter((answer) => answer === i).length);
    assert(Math.max(...counts) - Math.min(...counts) <= 1);
    if (index >= 8) assert(counts.every((count) => count === 1));
  }
  return problems;
}

async function main() {
  for (let number = 1; number <= 9; number++) {
    for (let iteration = 0; iteration < 20; iteration++) {
      checkProblems(number);
      checkProblems(number, '*');
      checkInverseProblems(number, '-');
      checkInverseProblems(number, '/');
    }
  }
  const reviews = new Set(Array.from({ length: 10 }, () =>
    JSON.stringify(checkProblems(1).slice(80))));
  assert(reviews.size > 1, 'Review orders must vary between worksheets');
  for (const operation of ['-', '/']) {
    const inverseReviews = new Set(Array.from({ length: 10 }, () =>
      JSON.stringify(checkInverseProblems(4, operation).slice(80))));
    assert(inverseReviews.size > 1, 'Subtraction and division review orders must vary between worksheets');
  }
  for (const extreme of [0, 1 - Number.EPSILON]) {
    context.Math.random = () => extreme;
    for (let number = 1; number <= 9; number++) {
      checkProblems(number);
      checkProblems(number, '*');
      checkInverseProblems(number, '-');
      checkInverseProblems(number, '/');
    }
  }
  delete context.Math.random;
  for (const invalid of [0, 10, -1, 1.5, NaN, '1']) {
    for (const operation of ['+', '*', '-', '/']) {
      assert.throws(() => context.getRollingFactProblems(invalid, operation), /1 through 9/);
    }
  }

  const menu = elements.get('rollingOptions');
  const button = elements.get('buildRollingWorksheet');
  assert(menu.hidden);
  const buttonTag = html.match(/<button\b[^>]*id="buildRollingWorksheet"[^>]*>/)[0];
  const click = buttonTag.match(/onclick="([^"]+)"/)[1];
  for (const operation of ['+', '*', '-', '/']) {
    const initialDownloads = downloads.length;
    const symbol = operation === '*' ? 'x' : operation;
    const menuSymbol = operation === '*' ? '&times;' : operation === '/' ? '&divide;' : operation;
    const operationName = { '+': 'addition', '*': 'multiplication', '-': 'subtraction', '/': 'division' }[operation];
    selectOperation(operation);
    assert(menu.hidden);
    assert.equal(elements.get('rollingChoices').innerHTML, '');
    assert.equal(button.attributes['aria-expanded'], 'false');
    vm.runInContext(click, context);
    assert(!menu.hidden);
    assert.equal(button.attributes['aria-expanded'], 'true');
    const menuElement = elements.get('rollingChoices');
    assert.equal(menuElement.attributes['aria-label'], `Rolling ${operationName} number`);
    const choices = [...menuElement.innerHTML.matchAll(/onclick="([^"]+)"/g)];
    assert.equal(choices.length, 9);
    for (let i = 0; i < choices.length; i++) {
      assert(menuElement.innerHTML.includes(`${menuSymbol}${i + 1}`));
      assert.equal(choices[i][1], `generateRollingWorksheet(${i + 1})`);
      vm.runInContext(choices[i][1], context);
      const download = downloads.at(-1);
      const fileLabel = operation === '/' ? `div${i + 1}` : `${symbol}${i + 1}`;
      const titleLabel = operation === '/' ? `Divide by ${i + 1}` : `${symbol}${i + 1}`;
      assert.equal(download.name, `Rolling Mastery ${fileLabel}.pdf`);
      assert.equal(download.blob.type, 'application/pdf');
      const data = await download.blob.text();
      assert(data.startsWith('%PDF-1.4'));
      assert.match(data, /\/Count 1\b/);
      const operators = data.match(/\([+x-]\) Tj/g) || [];
      assert.equal(operators.length, operation === '/' ? 0 : 100);
      assert(operators.every((text) => text === `(${symbol}) Tj`));
      if (operation === '/') {
        assert.equal((data.match(/\bc [\d.]+ [\d.]+ l S/g) || []).length, 100,
          'Each division problem needs a connected bracket and top bar');
        assert(!data.includes('&divide;'), 'HTML entities must not appear in the PDF');
      }
      assert(data.includes(`(Rolling Mastery ${titleLabel})`));
      assert(data.includes('(Name:)') && data.includes('(Time:)'));
      assert(!data.includes('mastered'));
      if (operation === '-' || operation === '/') {
        const operands = [...data.matchAll(/\((\d+)\) Tj/g)].map((match) => Number(match[1]));
        assert.equal(operands.length, 200);
        const answers = [];
        for (let index = 0; index < operands.length; index += 2) {
          // Division prints the divisor first, followed by the dividend inside the bar.
          const fixedNumber = operands[index + (operation === '/' ? 0 : 1)];
          assert.equal(fixedNumber, i + 1);
          const answer = operation === '/'
            ? operands[index + 1] / fixedNumber
            : operands[index] - fixedNumber;
          assert(Number.isInteger(answer) && answer >= 0 && answer <= 9,
            'The downloaded PDF must only contain whole-number answers from 0 through 9');
          answers.push(answer);
        }
        for (const rowIndex of [8, 9]) {
          assert.deepEqual(answers.slice(rowIndex * 10, rowIndex * 10 + 10).sort((a, b) => a - b),
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        }
      }
      if (process.argv[2]) {
        fs.mkdirSync(process.argv[2], { recursive: true });
        fs.writeFileSync(path.join(process.argv[2], download.name),
          Buffer.from(await download.blob.arrayBuffer()));
      }
    }
    vm.runInContext(choices[0][1], context);
    assert.equal(downloads.length, initialDownloads + 10,
      'Clicking the same number should download again');
    vm.runInContext(click, context);
    assert(menu.hidden);
    assert.equal(button.attributes['aria-expanded'], 'false');
    vm.runInContext(click, context);
  }
  assert.equal(downloads.length, 40);
  selectOperation('+');
  vm.runInContext(click, context);
  assert(!menu.hidden);
  assert(!elements.get('rollingChoices').innerHTML.includes('&times;'));
  assert(!elements.get('rollingChoices').innerHTML.includes('&divide;'));
  assert.equal(context.getSelectedCustomOperation(), '+');
  assert.equal(context.getSelectedMasteryOperation(), '/');
  assert(elements.get('worksOptions').hidden);
  assert.equal(alerts.length, 0);
  for (const operation of ['+', '-', '*', '/']) {
    const pages = context.getTheWorksPages(operation, 4);
    assert.equal(pages.length, 11);
    assert(pages.every((page) => page.problems.length === 100));
  }
  console.log('PASS: all four operations, numbers 1-9, exact rolling rows and complete randomized reviews.');
  console.log('Subtraction and division keep operands in order, have whole-number answers 0-9, and test each answer once per final row.');
  console.log('Menu open/close/reset, operation switching, independent controls, all 36 single-page PDF downloads,');
  console.log('connected division bars, repeat downloads, and existing mastery packets.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
