const http = require('http');
const fs = require('fs');
const path = require('path');

function loadLocalProblem() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'problem.json'), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function fetchProblem() {
  return new Promise((resolve, reject) => {
    http.get('http://192.168.60.104:8451/api/problem', (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Unexpected status code: ${res.statusCode}`));
        res.resume();
        return;
      }

      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    }).on('error', (error) => {
      const localProblem = loadLocalProblem();
      if (localProblem) {
        resolve(localProblem);
        return;
      }

      reject(error);
    });
  });
}

function solveLinearSystem(A, b) {
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
      throw new Error('Singular stiffness matrix');
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

function buildSystem(problem, members) {
  const nodes = problem.nodes;
  const loads = problem.loads;
  const n = nodes.length;
  const dof = (index, axis) => index * 2 + axis;

  const fixed = new Set();
  for (let i = 0; i < n; i += 1) {
    if (nodes[i][0] === 0 || nodes[i][0] === 900) {
      fixed.add(i);
    }
  }

  const freeDofs = [];
  for (let i = 0; i < n; i += 1) {
    if (!fixed.has(i)) {
      freeDofs.push(dof(i, 0), dof(i, 1));
    }
  }

  const K = Array.from({ length: 2 * n }, () => Array(2 * n).fill(0));
  const F = Array(2 * n).fill(0);

  for (const [nodeIndex, fx, fy] of loads) {
    F[dof(nodeIndex, 0)] += fx;
    F[dof(nodeIndex, 1)] += fy;
  }

  for (const [i, j] of members) {
    const dx = nodes[j][0] - nodes[i][0];
    const dy = nodes[j][1] - nodes[i][1];
    const length = Math.hypot(dx, dy);
    const c = dx / length;
    const s = dy / length;
    const k = 1 / length;

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

  return { K, F, freeDofs };
}

function memberKey(member) {
  return `${member[0]}-${member[1]}`;
}

function signatureForMembers(members) {
  return members.map(memberKey).join('|');
}

function computeAnalysis(problem, members, cache) {
  const signature = signatureForMembers(members);
  if (cache && cache.has(signature)) {
    return cache.get(signature);
  }

  const nodes = problem.nodes;
  const rodSide = problem.rodSide;
  const yieldMPa = problem.yieldMPa;
  const area = rodSide * rodSide;
  const n = nodes.length;
  const dof = (index, axis) => index * 2 + axis;

  const { K, F, freeDofs } = buildSystem(problem, members);
  const Kff = freeDofs.map((row) => freeDofs.map((col) => K[row][col]));
  const Ff = freeDofs.map((index) => F[index]);

  let U;
  try {
    U = solveLinearSystem(Kff, Ff);
  } catch (error) {
    const result = { feasible: false, minSafetyFactor: 0, nodeResults: [], memberForces: [] };
    if (cache) {
      cache.set(signature, result);
    }
    return result;
  }

  const Ufull = Array(2 * n).fill(0);
  freeDofs.forEach((dofIndex, index) => {
    Ufull[dofIndex] = U[index];
  });

  const memberForces = members.map(([i, j]) => {
    const dx = nodes[j][0] - nodes[i][0];
    const dy = nodes[j][1] - nodes[i][1];
    const length = Math.hypot(dx, dy);
    const c = dx / length;
    const s = dy / length;
    const delta =
      (Ufull[dof(j, 0)] - Ufull[dof(i, 0)]) * c +
      (Ufull[dof(j, 1)] - Ufull[dof(i, 1)]) * s;

    return { i, j, force: delta / length };
  });

  const incident = new Map();
  for (const member of memberForces) {
    if (!incident.has(member.i)) incident.set(member.i, []);
    if (!incident.has(member.j)) incident.set(member.j, []);
    incident.get(member.i).push(Math.abs(member.force));
    incident.get(member.j).push(Math.abs(member.force));
  }

  const nodeResults = [];
  let minSafetyFactor = Number.POSITIVE_INFINITY;

  for (let node = 0; node < n; node += 1) {
    const forces = incident.get(node) || [];
    const maxForce = forces.length > 0 ? Math.max(...forces) : 0;
    const stress = maxForce / area / 1e6;
    const safetyFactor = stress > 0 ? yieldMPa / stress : Number.POSITIVE_INFINITY;

    nodeResults.push({ node, maxForce, stress, safetyFactor });
    minSafetyFactor = Math.min(minSafetyFactor, safetyFactor);
  }

  const result = {
    feasible: true,
    minSafetyFactor,
    nodeResults,
    memberForces,
  };

  if (cache) {
    cache.set(signature, result);
  }

  return result;
}

function getMemberForce(analysis, member) {
  const [i, j] = member;
  const found = analysis.memberForces.find((item) => {
    const sameDirection = item.i === i && item.j === j;
    const reverseDirection = item.i === j && item.j === i;
    return sameDirection || reverseDirection;
  });

  return found ? Math.abs(found.force) : 0;
}

function getFeasibleRemovals(problem, members, cache) {
  const currentAnalysis = computeAnalysis(problem, members, cache);
  const feasible = [];

  if (!currentAnalysis.feasible) {
    return feasible;
  }

  for (let index = 0; index < members.length; index += 1) {
    const member = members[index];
    const candidate = members.filter((_, memberIndex) => memberIndex !== index);
    const candidateAnalysis = computeAnalysis(problem, candidate, cache);

    if (candidateAnalysis.feasible && candidateAnalysis.minSafetyFactor >= 1) {
      feasible.push({
        removalIndex: index,
        member,
        currentForce: getMemberForce(currentAnalysis, member),
        candidate,
        analysis: candidateAnalysis,
      });
    }
  }

  return feasible;
}

function compareCandidates(a, b) {
  if (b.analysis.minSafetyFactor !== a.analysis.minSafetyFactor) {
    return b.analysis.minSafetyFactor - a.analysis.minSafetyFactor;
  }

  if (a.currentForce !== b.currentForce) {
    return a.currentForce - b.currentForce;
  }

  return a.removalIndex - b.removalIndex;
}

function greedyReduce(problem, members, cache) {
  let current = members.slice();

  while (true) {
    const feasible = getFeasibleRemovals(problem, current, cache);
    if (feasible.length === 0) {
      break;
    }

    feasible.sort(compareCandidates);
    const best = feasible[0];
    current = best.candidate;
  }

  const finalAnalysis = computeAnalysis(problem, current, cache);
  return { members: current, analysis: finalAnalysis };
}

function combinations(items, size) {
  const result = [];

  function build(start, depth, current) {
    if (depth === size) {
      result.push(current.slice());
      return;
    }

    for (let index = start; index <= items.length - (size - depth); index += 1) {
      current.push(items[index]);
      build(index + 1, depth + 1, current);
      current.pop();
    }
  }

  build(0, 0, []);
  return result;
}

function batchImprove(problem, members, cache) {
  let current = members.slice();
  let improved = true;

  while (improved) {
    improved = false;
    const analysis = computeAnalysis(problem, current, cache);
    const ranked = current
      .map((member, index) => ({
        index,
        member,
        force: getMemberForce(analysis, member),
      }))
      .sort((a, b) => a.force - b.force || a.index - b.index);

    const topCount = Math.min(14, ranked.length);
    const topIndices = ranked.slice(0, topCount).map((item) => item.index);
    let bestBatch = null;

    for (let batchSize = 2; batchSize <= 3; batchSize += 1) {
      for (const combo of combinations(topIndices, batchSize)) {
        const candidate = current.filter((_, index) => !combo.includes(index));
        const candidateAnalysis = computeAnalysis(problem, candidate, cache);

        if (!candidateAnalysis.feasible || candidateAnalysis.minSafetyFactor < 1) {
          continue;
        }

        const sumForce = combo.reduce((total, index) => total + getMemberForce(analysis, current[index]), 0);
        const batchScore = {
          batchSize,
          sumForce,
          safetyFactor: candidateAnalysis.minSafetyFactor,
        };

        if (
          !bestBatch ||
          batchScore.batchSize > bestBatch.batchScore.batchSize ||
          (batchScore.batchSize === bestBatch.batchScore.batchSize && batchScore.sumForce < bestBatch.batchScore.sumForce) ||
          (batchScore.batchSize === bestBatch.batchScore.batchSize &&
            batchScore.sumForce === bestBatch.batchScore.sumForce &&
            batchScore.safetyFactor > bestBatch.batchScore.safetyFactor)
        ) {
          bestBatch = { combo, candidate, candidateAnalysis, batchScore };
        }
      }

      if (bestBatch) {
        break;
      }
    }

    if (!bestBatch) {
      break;
    }

    current = bestBatch.candidate;
    const reduced = greedyReduce(problem, current, cache);
    current = reduced.members;
    improved = true;
  }

  const finalAnalysis = computeAnalysis(problem, current, cache);
  return { members: current, analysis: finalAnalysis };
}

function optimizeMembers(problem) {
  const cache = new Map();
  const initial = greedyReduce(problem, problem.members, cache);
  const improved = batchImprove(problem, initial.members, cache);
  return {
    optimizedMembers: improved.members,
    finalAnalysis: improved.analysis,
    originalCount: problem.members.length,
    removedCount: problem.members.length - improved.members.length,
  };
}

async function main() {
  const problem = await fetchProblem();
  const originalAnalysis = computeAnalysis(problem, problem.members);
  const optimization = optimizeMembers(problem);

  const outputPath = path.join(__dirname, 'optimized_solution.json');
  const output = {
    generatedAt: new Date().toISOString(),
    originalMembers: problem.members.length,
    optimizedMembers: optimization.optimizedMembers.length,
    removedMembers: optimization.removedCount,
    originalMinSafetyFactor: originalAnalysis.minSafetyFactor,
    optimizedMinSafetyFactor: optimization.finalAnalysis.minSafetyFactor,
    optimizedNodeResults: optimization.finalAnalysis.nodeResults,
    optimizedMembersList: optimization.optimizedMembers,
    nodes: problem.nodes,
    loads: problem.loads,
    rodSide: problem.rodSide,
    yieldMPa: problem.yieldMPa,
    members: problem.members,
    search: {
      method: 'greedy-plus-batch-improve',
      batchTopCount: 14,
      batchSizes: [2, 3],
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  console.log(JSON.stringify({
    originalMembers: problem.members.length,
    optimizedMembers: optimization.optimizedMembers.length,
    removedMembers: optimization.removedCount,
    originalMinSafetyFactor: originalAnalysis.minSafetyFactor,
    optimizedMinSafetyFactor: optimization.finalAnalysis.minSafetyFactor,
    outputPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
