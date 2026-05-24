const fs = require('fs');
const path = require('path');

const problem = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'problem.json'), 'utf8'));
const solution = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'optimized_solution.json'), 'utf8'));
const members = solution.optimizedMembersList;

const dof = (i, a) => i * 2 + a;
const fixed = new Set();
for (let i = 0; i < problem.nodes.length; i += 1) {
  if (problem.nodes[i][0] === 0 || problem.nodes[i][0] === 900) {
    fixed.add(i);
  }
}
const freeDofs = [];
for (let i = 0; i < problem.nodes.length; i += 1) {
  if (!fixed.has(i)) {
    freeDofs.push(dof(i, 0), dof(i, 1));
  }
}

function buildSystem(currentMembers) {
  const K = Array.from({ length: 2 * problem.nodes.length }, () => Array(2 * problem.nodes.length).fill(0));
  const F = Array(2 * problem.nodes.length).fill(0);

  for (const [nodeIndex, fx, fy] of problem.loads) {
    F[dof(nodeIndex, 0)] += fx;
    F[dof(nodeIndex, 1)] += fy;
  }

  for (const [i, j] of currentMembers) {
    const dx = problem.nodes[j][0] - problem.nodes[i][0];
    const dy = problem.nodes[j][1] - problem.nodes[i][1];
    const len = Math.hypot(dx, dy);
    const c = dx / len;
    const s = dy / len;
    const k = 1 / len;

    const g = [
      [c * c, c * s, -c * c, -c * s],
      [c * s, s * s, -c * s, -s * s],
      [-c * c, -c * s, c * c, c * s],
      [-c * s, -s * s, c * s, s * s],
    ].map((row) => row.map((value) => value * k));

    const rows = [dof(i, 0), dof(i, 1), dof(j, 0), dof(j, 1)];
    for (let a = 0; a < 4; a += 1) {
      for (let b = 0; b < 4; b += 1) {
        K[rows[a]][rows[b]] += g[a][b];
      }
    }
  }

  return { K, F };
}

function solve(A, b) {
  const M = A.map((row, i) => row.slice().concat([b[i]]));
  const n = M.length;

  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < n; r += 1) {
      if (Math.abs(M[r][i]) > Math.abs(M[pivot][i])) {
        pivot = r;
      }
    }

    if (Math.abs(M[pivot][i]) < 1e-12) {
      throw new Error('singular');
    }

    [M[i], M[pivot]] = [M[pivot], M[i]];
    const pv = M[i][i];

    for (let c = i; c <= n; c += 1) {
      M[i][c] /= pv;
    }

    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const factor = M[r][i];
      for (let c = i; c <= n; c += 1) {
        M[r][c] -= factor * M[i][c];
      }
    }
  }

  return M.map((row) => row[n]);
}

const { K, F } = buildSystem(members);
const Kff = freeDofs.map((row) => freeDofs.map((col) => K[row][col]));
const Ff = freeDofs.map((index) => F[index]);
const U = solve(Kff, Ff);
const Ufull = Array(2 * problem.nodes.length).fill(0);
freeDofs.forEach((dofIndex, index) => {
  Ufull[dofIndex] = U[index];
});

const memberForces = members.map(([i, j]) => {
  const dx = problem.nodes[j][0] - problem.nodes[i][0];
  const dy = problem.nodes[j][1] - problem.nodes[i][1];
  const len = Math.hypot(dx, dy);
  const c = dx / len;
  const s = dy / len;
  const delta =
    (Ufull[dof(j, 0)] - Ufull[dof(i, 0)]) * c +
    (Ufull[dof(j, 1)] - Ufull[dof(i, 1)]) * s;

  return { i, j, force: delta / len };
});

const target = 15;
const incident = members
  .map((member, index) => ({
    index,
    member,
    force: memberForces.find((item) =>
      (item.i === member[0] && item.j === member[1]) || (item.i === member[1] && item.j === member[0])
    )?.force || 0,
  }))
  .filter((item) => item.member[0] === target || item.member[1] === target)
  .sort((a, b) => Math.abs(b.force) - Math.abs(a.force));

console.log(JSON.stringify({ target, incident }, null, 2));
