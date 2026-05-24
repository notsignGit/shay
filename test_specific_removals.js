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

function analyze(currentMembers) {
  const { K, F } = buildSystem(currentMembers);
  const Kff = freeDofs.map((row) => freeDofs.map((col) => K[row][col]));
  const Ff = freeDofs.map((index) => F[index]);

  let U;
  try {
    U = solve(Kff, Ff);
  } catch (error) {
    return { feasible: false, minSafetyFactor: 0, memberForces: [] };
  }

  const Ufull = Array(2 * problem.nodes.length).fill(0);
  freeDofs.forEach((dofIndex, index) => {
    Ufull[dofIndex] = U[index];
  });

  const memberForces = currentMembers.map(([i, j]) => {
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

  const incident = new Map();
  for (const member of memberForces) {
    if (!incident.has(member.i)) incident.set(member.i, []);
    if (!incident.has(member.j)) incident.set(member.j, []);
    incident.get(member.i).push(Math.abs(member.force));
    incident.get(member.j).push(Math.abs(member.force));
  }

  let minSafetyFactor = Infinity;
  for (let node = 0; node < problem.nodes.length; node += 1) {
    const forces = incident.get(node) || [];
    const maxForce = forces.length > 0 ? Math.max(...forces) : 0;
    const stress = maxForce / (problem.rodSide * problem.rodSide) / 1e6;
    const safetyFactor = stress > 0 ? problem.yieldMPa / stress : Infinity;
    minSafetyFactor = Math.min(minSafetyFactor, safetyFactor);
  }

  return { feasible: true, minSafetyFactor, memberForces };
}

const targets = [32, 29, 12, 31, 10, 33];
for (const idx of targets) {
  const candidate = members.filter((_, memberIndex) => memberIndex !== idx);
  const result = analyze(candidate);
  console.log(JSON.stringify({ removedIndex: idx, member: members[idx], feasible: result.feasible, minSafetyFactor: result.minSafetyFactor }, null, 2));
}
