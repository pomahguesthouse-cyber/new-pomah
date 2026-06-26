const params = {
  pollIntervalSec: 2,
  smartDelaySec: {
    short: 8,
    medium: 6,
    long: 5,
    waitSignal: 10,
    cap: 12,
  },
  aiTimeoutSec: 40,
  aiAttempts: 2,
  lockTtlSec: 120,
};

const scenarios = [
  {
    name: "Normal FAQ",
    aiSec: () => triangular(5, 9, 16),
    mix: { short: 0.25, medium: 0.55, long: 0.2 },
  },
  {
    name: "Booking/availability",
    aiSec: () => triangular(9, 18, 32),
    mix: { short: 0.2, medium: 0.45, long: 0.35 },
  },
  {
    name: "LLM lambat",
    aiSec: () => triangular(18, 35, 42),
    mix: { short: 0.2, medium: 0.5, long: 0.3 },
  },
  {
    name: "Timeout then retry",
    aiSec: () => triangular(38, 55, 83),
    mix: { short: 0.2, medium: 0.45, long: 0.35 },
  },
];

const loadsPerHour = [30, 60, 120, 240, 480];
const workerParallelism = [1, 2, 4, 8];

function triangular(min, mode, max) {
  const u = Math.random();
  const c = (mode - min) / (max - min);
  if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

function percentile(xs, p) {
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function pickDelaySec(mix) {
  const u = Math.random();
  if (u < (mix.short ?? 0)) return params.smartDelaySec.short;
  if (u < (mix.short ?? 0) + (mix.medium ?? 0)) return params.smartDelaySec.medium;
  return params.smartDelaySec.long;
}

function expInterarrival(ratePerSec) {
  return -Math.log(1 - Math.random()) / ratePerSec;
}

function simulate({ scenario, arrivalsPerHour, parallelism, horizonHours = 1 }) {
  const count = Math.max(1, Math.round(arrivalsPerHour * horizonHours));
  const arrivals = [];
  let t = 0;
  const ratePerSec = arrivalsPerHour / 3600;
  for (let i = 0; i < count; i++) {
    t += expInterarrival(ratePerSec);
    const debounce = Math.min(pickDelaySec(scenario.mix), params.smartDelaySec.cap);
    const readyAt = t + debounce;
    const polledAt = Math.ceil(readyAt / params.pollIntervalSec) * params.pollIntervalSec;
    let service = scenario.aiSec();
    service = Math.min(service, params.aiTimeoutSec * params.aiAttempts + 2);
    arrivals.push({ arrivalAt: t, readyAt, polledAt, service });
  }

  const workerFreeAt = Array(parallelism).fill(0);
  const latencies = [];
  const schedulerDelays = [];
  const zombieRisks = [];

  for (const job of arrivals) {
    let worker = 0;
    for (let i = 1; i < workerFreeAt.length; i++) {
      if (workerFreeAt[i] < workerFreeAt[worker]) worker = i;
    }
    const start = Math.max(job.polledAt, workerFreeAt[worker]);
    const finish = start + job.service;
    workerFreeAt[worker] = finish;
    latencies.push(finish - job.arrivalAt);
    schedulerDelays.push(start - job.readyAt);
    zombieRisks.push(job.service > params.lockTtlSec);
  }

  return {
    avg: avg(latencies),
    p50: percentile(latencies, 50),
    p90: percentile(latencies, 90),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    schedulerP95: percentile(schedulerDelays, 95),
    max: Math.max(...latencies),
    zombieRiskPct: (zombieRisks.filter(Boolean).length / zombieRisks.length) * 100,
  };
}

function avg(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function fmt(sec) {
  return `${sec.toFixed(1)}s`;
}

console.log("Chatbot performance simulation");
console.log(JSON.stringify(params, null, 2));
console.log("");

for (const scenario of scenarios) {
  console.log(`=== ${scenario.name} ===`);
  for (const parallelism of workerParallelism) {
    const rows = loadsPerHour.map((load) => {
      const r = simulate({ scenario, arrivalsPerHour: load, parallelism, horizonHours: 2 });
      return {
        load,
        c: parallelism,
        p50: fmt(r.p50),
        p90: fmt(r.p90),
        p95: fmt(r.p95),
        p99: fmt(r.p99),
        sched95: fmt(r.schedulerP95),
        max: fmt(r.max),
        zombie: `${r.zombieRiskPct.toFixed(1)}%`,
      };
    });
    console.table(rows);
  }
}
