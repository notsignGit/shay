async function loadData() {
  const problemResponse = await fetch('problem.json');
  const problem = await problemResponse.json();

  let solution = null;
  try {
    const solutionResponse = await fetch('optimized_solution.json');
    if (solutionResponse.ok) {
      solution = await solutionResponse.json();
    }
  } catch (error) {
    solution = null;
  }

  return { problem, solution };
}

function createFallbackDemo() {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'center';
  container.style.gap = '12px';
  container.style.padding = '24px';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.minHeight = '100vh';
  container.style.boxSizing = 'border-box';

  const title = document.createElement('h1');
  title.textContent = 'תצוגת טרס';

  const message = document.createElement('p');
  message.textContent = 'לא ניתן לטעון את הפתרון האופטימלי כרגע.';

  container.append(title, message);
  return container;
}

function makeScreenTransform(nodes, width, height, padding) {
  const xs = nodes.map(([x]) => x);
  const ys = nodes.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (width - padding * 2) / Math.max(1, maxX - minX),
    (height - padding * 2) / Math.max(1, maxY - minY)
  );

  return {
    scale,
    toScreen([x, y]) {
      return {
        x: padding + (x - minX) * scale,
        y: height - padding - (y - minY) * scale,
      };
    },
    minX,
    maxX,
    minY,
    maxY,
  };
}

function drawGrid(ctx, transform, width, height, padding) {
  const stepX = 100;
  const stepY = 100;
  ctx.save();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;

  for (let x = Math.ceil(transform.minX / stepX) * stepX; x <= transform.maxX; x += stepX) {
    const { x: px } = transform.toScreen([x, transform.minY]);
    ctx.beginPath();
    ctx.moveTo(px, padding);
    ctx.lineTo(px, height - padding);
    ctx.stroke();
  }

  for (let y = Math.ceil(transform.minY / stepY) * stepY; y <= transform.maxY; y += stepY) {
    const { y: py } = transform.toScreen([transform.minX, y]);
    ctx.beginPath();
    ctx.moveTo(padding, py);
    ctx.lineTo(width - padding, py);
    ctx.stroke();
  }

  ctx.restore();
}

function drawArrow(ctx, from, to, color, width = 2) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return;
  }

  const angle = Math.atan2(dy, dx);
  const headLength = 10;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - headLength * Math.cos(angle - Math.PI / 6), to.y - headLength * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - headLength * Math.cos(angle + Math.PI / 6), to.y - headLength * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function createTrussCanvas({ problem, solution, width = 960, height = 720 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.borderRadius = '16px';
  canvas.style.boxShadow = '0 12px 30px rgba(15, 23, 42, 0.12)';
  canvas.style.background = '#ffffff';

  const ctx = canvas.getContext('2d');
  const padding = 56;
  const transform = makeScreenTransform(problem.nodes, width, height, padding);
  const selectedMembers = new Set((solution?.optimizedMembersList || problem.members).map(([a, b]) => `${a}-${b}`));

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, transform, width, height, padding);

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.stroke();

  ctx.font = '13px Arial';
  ctx.fillStyle = '#475569';
  ctx.fillText('x', width - padding + 4, height - padding + 4);
  ctx.fillText('y', padding - 18, padding + 8);

  problem.members.forEach(([i, j]) => {
    const p1 = transform.toScreen(problem.nodes[i]);
    const p2 = transform.toScreen(problem.nodes[j]);
    const isSelected = selectedMembers.has(`${i}-${j}`) || selectedMembers.has(`${j}-${i}`);

    ctx.save();
    ctx.strokeStyle = isSelected ? '#10b981' : '#cbd5e1';
    ctx.lineWidth = isSelected ? 4 : 1.5;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  });

  problem.nodes.forEach((node, index) => {
    const point = transform.toScreen(node);
    const isLoadNode = (problem.loads || []).some(([nodeIndex]) => nodeIndex === index);

    ctx.save();
    ctx.fillStyle = isLoadNode ? '#f59e0b' : '#0f172a';
    ctx.beginPath();
    ctx.arc(point.x, point.y, isLoadNode ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (index % 10 === 0) {
      ctx.fillStyle = '#334155';
      ctx.font = '12px Arial';
      ctx.fillText(String(index), point.x + 7, point.y - 7);
    }
  });

  (problem.loads || []).forEach(([nodeIndex, fx, fy]) => {
    const node = problem.nodes[nodeIndex];
    const start = transform.toScreen(node);
    const end = transform.toScreen([
      node[0] + fx / 200,
      node[1] + fy / 200,
    ]);

    drawArrow(ctx, start, end, '#dc2626', 2.5);
  });

  return canvas;
}

function renderTruss({ problem, solution }) {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.alignItems = 'center';
  container.style.gap = '16px';
  container.style.padding = '24px';
  container.style.fontFamily = 'Arial, sans-serif';
  container.style.minHeight = '100vh';
  container.style.boxSizing = 'border-box';
  container.style.background = '#f8fafc';

  const title = document.createElement('h1');
  title.textContent = 'תצוגת הפתרון האופטימלי';
  title.style.margin = '0';
  title.style.color = '#0f172a';

  const subtitle = document.createElement('p');
  subtitle.style.margin = '0';
  subtitle.style.maxWidth = '900px';
  subtitle.style.textAlign = 'center';
  subtitle.style.color = '#334155';
  subtitle.textContent = 'המסך מציג את קבוצת המוטות שנשארה לאחר אופטימיזציה, יחד עם העומסים והנקודות החשובות של המערכת.';

  const canvas = createTrussCanvas({ problem, solution });

  const summary = document.createElement('div');
  summary.style.display = 'grid';
  summary.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
  summary.style.gap = '12px';
  summary.style.width = '100%';
  summary.style.maxWidth = '960px';

  const kit = (label, value, color) => {
    const box = document.createElement('div');
    box.style.background = '#ffffff';
    box.style.borderRadius = '14px';
    box.style.padding = '14px 16px';
    box.style.boxShadow = '0 8px 24px rgba(15, 23, 42, 0.08)';
    box.style.border = `1px solid ${color}`;

    const titleEl = document.createElement('div');
    titleEl.textContent = label;
    titleEl.style.fontSize = '13px';
    titleEl.style.color = '#64748b';

    const valueEl = document.createElement('div');
    valueEl.textContent = value;
    valueEl.style.fontSize = '20px';
    valueEl.style.fontWeight = '700';
    valueEl.style.color = '#0f172a';

    box.append(titleEl, valueEl);
    return box;
  };

  const originalCount = solution?.originalMembers ?? problem.members.length;
  const optimizedCount = solution?.optimizedMembers ?? problem.members.length;
  const removedCount = solution?.removedMembers ?? Math.max(0, originalCount - optimizedCount);
  const minSF = solution?.optimizedMinSafetyFactor ?? 'לא זמין';

  summary.append(
    kit('מוטות מקוריים', String(originalCount), '#cbd5e1'),
    kit('מוטות לאחר אופטימיזציה', String(optimizedCount), '#10b981'),
    kit('מוטות מוסרים', String(removedCount), '#f59e0b'),
    kit('SF מינימלי', typeof minSF === 'number' ? minSF.toFixed(4) : String(minSF), '#0ea5e9')
  );

  const legend = document.createElement('div');
  legend.style.display = 'flex';
  legend.style.flexWrap = 'wrap';
  legend.style.gap = '12px';
  legend.style.justifyContent = 'center';
  legend.style.color = '#334155';

  const chips = [
    { label: 'מוטות שנשמרו', color: '#10b981' },
    { label: 'מוטות שהוסרו', color: '#cbd5e1' },
    { label: 'עומס', color: '#dc2626' },
    { label: 'צומת עומס', color: '#f59e0b' },
  ];

  chips.forEach(({ label, color }) => {
    const chip = document.createElement('span');
    chip.style.display = 'inline-flex';
    chip.style.alignItems = 'center';
    chip.style.gap = '8px';
    chip.style.padding = '8px 12px';
    chip.style.borderRadius = '999px';
    chip.style.background = '#ffffff';
    chip.style.boxShadow = '0 8px 20px rgba(15, 23, 42, 0.08)';

    const dot = document.createElement('span');
    dot.style.width = '12px';
    dot.style.height = '12px';
    dot.style.borderRadius = '999px';
    dot.style.background = color;

    chip.append(dot, document.createTextNode(label));
    legend.appendChild(chip);
  });

  container.append(title, subtitle, canvas, summary, legend);
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  document.body.style.background = '#f8fafc';
  document.body.appendChild(container);
}

async function bootstrap() {
  try {
    const { problem, solution } = await loadData();
    renderTruss({ problem, solution });
  } catch (error) {
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.style.background = '#f8fafc';
    document.body.appendChild(createFallbackDemo());
  }
}

if (typeof document !== 'undefined') {
  bootstrap();
}
