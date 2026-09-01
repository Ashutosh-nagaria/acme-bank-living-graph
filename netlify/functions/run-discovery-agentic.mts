import type { Context, Config } from "@netlify/functions";
import neo4j from "neo4j-driver";

const SOURCES = ["Cloud Inventory API", "Network Discovery Scan", "Config Management Agent"];

const CANDIDATE_POOL = [
  { name: "Compliance Reporting Service", type: "Application", anchor: "Customer DB", relType: "depends_on", direction: "forward" },
  { name: "Fraud Analytics Service", type: "Application", anchor: "Fraud DB", relType: "depends_on", direction: "forward" },
  { name: "Cache Layer", type: "Storage", anchor: "Payments API", relType: "depends_on", direction: "reverse" },
  { name: "DR-LB", type: "LoadBalancer", anchor: "Customer Portal", relType: "routes_to", direction: "forward" },
  { name: "APP-SRV-05", type: "Server", anchor: "Fraud Detection Service", relType: "depends_on", direction: "reverse" }
];

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randomPastTime(minMinutesAgo: number, maxMinutesAgo: number, base: number) {
  const minutesAgo = minMinutesAgo + Math.random() * (maxMinutesAgo - minMinutesAgo);
  return new Date(base - minutesAgo * 60000).toISOString();
}

export default async (req: Request, context: Context) => {
  const uri = Netlify.env.get("NEO4J_URI");
  const username = Netlify.env.get("NEO4J_USERNAME");
  const password = Netlify.env.get("NEO4J_PASSWORD");
  const apiKey = Netlify.env.get("DEEPSEEK_API_KEY");

  if (!uri || !username || !password) {
    return new Response(JSON.stringify({ error: "Missing Neo4j credentials" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing DEEPSEEK_API_KEY" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  const session = driver.session();

  try {
    const now = Date.now();
    const lastSeen = new Date(now).toISOString();

    const existingCheck = await session.run(
      `MATCH (n) WHERE n.name IN $names RETURN n.name AS name`,
      { names: CANDIDATE_POOL.map(c => c.name) }
    );
    const existingNames = new Set(existingCheck.records.map(r => r.get("name")));
    const undiscovered = CANDIDATE_POOL.filter(c => !existingNames.has(c.name));
    const currentlyDiscovered = CANDIDATE_POOL.filter(c => existingNames.has(c.name));

    const retiredAssetNames: string[] = [];
    const retiredNodeIds: string[] = [];
    const lifecycleEvents: any[] = [];

    if (currentlyDiscovered.length > 0 && Math.random() < 0.4) {
      const toRetire = pickRandom(currentlyDiscovered, 1)[0];
      const retireLookup = await session.run(`MATCH (n {name: $name}) RETURN id(n) AS id`, { name: toRetire.name });
      if (retireLookup.records.length > 0) {
        const nodeId = retireLookup.records[0].get("id").toString();
        await session.run(`MATCH (n {name: $name}) DETACH DELETE n`, { name: toRetire.name });
        retiredAssetNames.push(toRetire.name);
        retiredNodeIds.push(nodeId);
        lifecycleEvents.push({
          asset: toRetire.name,
          field: "lifecycle",
          rule: "retired",
          detail: `No source reported this asset in the current discovery cycle`,
          resolved: "retired / removed from CMDB"
        });
      }
    }

    const newCount = Math.min(undiscovered.length, 1 + Math.floor(Math.random() * 3));
    const toDiscover = pickRandom(undiscovered, newCount);

    const allExisting = await session.run(`MATCH (n) WHERE NOT n:DiscoveryRun RETURN n.name AS name, id(n) AS id`);
    const existingList = allExisting.records.map(r => ({ name: r.get("name") as string, id: r.get("id").toString() }));
    const updateCount = Math.min(existingList.length, Math.floor(Math.random() * 3));
    const toUpdate = pickRandom(existingList, updateCount);

    type RawConflict = { asset: string; field: string; sourceA: any; sourceB: any };
    const rawConflicts: RawConflict[] = [];

    for (const candidate of toDiscover) {
      const [sourceA, sourceB] = pickRandom(SOURCES, 2);
      if (Math.random() < 0.5) {
        const aVal = Math.random() < 0.5 ? "staging" : "production";
        const bVal = aVal === "staging" ? "production" : "staging";
        rawConflicts.push({
          asset: candidate.name, field: "environment",
          sourceA: { name: sourceA, value: aVal, observedAt: randomPastTime(30, 200, now) },
          sourceB: { name: sourceB, value: bVal, observedAt: randomPastTime(1, 25, now) }
        });
      } else {
        const owners = ["Platform Engineering", "Payments Engineering", "SRE Team"];
        const owner = owners[Math.floor(Math.random() * owners.length)];
        const knowingIsA = Math.random() < 0.5;
        rawConflicts.push({
          asset: candidate.name, field: "owner_team",
          sourceA: { name: sourceA, value: knowingIsA ? owner : null, observedAt: randomPastTime(5, 100, now) },
          sourceB: { name: sourceB, value: knowingIsA ? null : owner, observedAt: randomPastTime(5, 100, now) }
        });
      }
    }

    for (const asset of toUpdate) {
      const [sourceA, sourceB] = pickRandom(SOURCES, 2);
      const patchDate = new Date(now - 1000 * 60 * 60 * 24 * Math.floor(Math.random() * 90)).toISOString().slice(0, 10);
      rawConflicts.push({
        asset: asset.name, field: "last_patched",
        sourceA: { name: sourceA, value: null, observedAt: randomPastTime(60, 300, now) },
        sourceB: { name: sourceB, value: patchDate, observedAt: randomPastTime(1, 30, now) }
      });
    }

    let decisions: any[] = [];

    if (rawConflicts.length > 0) {
      const systemPrompt = `You are a CMDB reconciliation engine investigating conflicting reports about IT infrastructure assets from independent discovery sources. For each conflict, investigate the evidence given (timestamps, which value is present vs missing, prior known state if given, or general judgment about source reliability for that field) and produce a recommendation. Break your reasoning into 2 to 4 short, concrete evidence bullets, each under 12 words, stating a specific factor you weighed, not a restatement of the conflict itself. Assign a confidence level of "High", "Medium", or "Low" based on how clear-cut the evidence is. A null value means that source did not report anything for that field. Respond with ONLY a JSON array, no markdown formatting, no prose outside the array, in exactly this shape: [{"asset": string, "field": string, "trustedSource": string, "resolvedValue": string, "confidence": "High" | "Medium" | "Low", "evidence": string[]}]`;

      const apiResponse = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(rawConflicts) }
          ]
        })
      });

      if (!apiResponse.ok) {
        const errText = await apiResponse.text();
        throw new Error(`DeepSeek API error: ${apiResponse.status} ${errText}`);
      }

      const apiData = await apiResponse.json();
      const text = apiData.choices?.[0]?.message?.content || "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      decisions = JSON.parse(cleaned);
    }

    function findDecision(asset: string, field: string) {
      return decisions.find(d => d.asset === asset && d.field === field);
    }

    const conflicts: any[] = [...lifecycleEvents];
    const newAssetNames: string[] = [];
    const updatedAssetNames: string[] = [];
    const newNodesForClient: any[] = [];
    const newEdgesForClient: any[] = [];

    for (const candidate of toDiscover) {
      const raw = rawConflicts.find(c => c.asset === candidate.name)!;
      const decision = findDecision(candidate.name, raw.field);
      const resolvedValue = decision ? decision.resolvedValue : (raw.sourceB.value ?? raw.sourceA.value);
      const evidence = decision && Array.isArray(decision.evidence) ? decision.evidence : ["Model did not return evidence for this asset; defaulted to the second source."];
      const confidence = decision ? decision.confidence : "Low";
      const trustedSource = decision ? decision.trustedSource : raw.sourceB.name;

      conflicts.push({
        asset: candidate.name,
        field: raw.field,
        rule: "agentic-investigation",
        observations: [
          { source: raw.sourceA.name, value: raw.sourceA.value, observedAt: raw.sourceA.observedAt },
          { source: raw.sourceB.name, value: raw.sourceB.value, observedAt: raw.sourceB.observedAt }
        ],
        evidence,
        trustedSource,
        confidence,
        resolved: resolvedValue
      });
      newAssetNames.push(candidate.name);

      const resolvedEnv = raw.field === "environment" ? resolvedValue : "production";
      const resolvedOwner = raw.field === "owner_team" ? resolvedValue : "Unassigned";

      const createQuery = candidate.direction === "forward"
        ? `MATCH (anchor {name: $anchorName})
           CREATE (n:${candidate.type} {name: $name, environment: $env, owner_team: $owner, discovered_via: $sources, last_seen: $lastSeen})
           MERGE (n)-[r:${candidate.relType}]->(anchor)
           RETURN n, r, anchor`
        : `MATCH (anchor {name: $anchorName})
           CREATE (n:${candidate.type} {name: $name, environment: $env, owner_team: $owner, discovered_via: $sources, last_seen: $lastSeen})
           MERGE (anchor)-[r:${candidate.relType}]->(n)
           RETURN n, r, anchor`;

      const result = await session.run(createQuery, {
        anchorName: candidate.anchor, name: candidate.name,
        env: resolvedEnv, owner: resolvedOwner,
        sources: `${raw.sourceA.name} + ${raw.sourceB.name}`, lastSeen
      });

      const rec = result.records[0];
      const n = rec.get("n"); const r = rec.get("r"); const anchor = rec.get("anchor");

      newNodesForClient.push({ id: n.identity.toString(), label: n.properties.name, group: n.labels[0] });
      newEdgesForClient.push({
        id: r.identity.toString(),
        from: candidate.direction === "forward" ? n.identity.toString() : anchor.identity.toString(),
        to: candidate.direction === "forward" ? anchor.identity.toString() : n.identity.toString(),
        label: candidate.relType
      });
    }

    for (const asset of toUpdate) {
      const raw = rawConflicts.find(c => c.asset === asset.name)!;
      const decision = findDecision(asset.name, "last_patched");
      const resolvedValue = decision ? decision.resolvedValue : raw.sourceB.value;
      const evidence = decision && Array.isArray(decision.evidence) ? decision.evidence : ["Model did not return evidence; defaulted to the source with a value present."];
      const confidence = decision ? decision.confidence : "Low";
      const trustedSource = decision ? decision.trustedSource : raw.sourceB.name;

      conflicts.push({
        asset: asset.name,
        field: "last_patched",
        rule: "agentic-investigation",
        observations: [
          { source: raw.sourceA.name, value: raw.sourceA.value, observedAt: raw.sourceA.observedAt },
          { source: raw.sourceB.name, value: raw.sourceB.value, observedAt: raw.sourceB.observedAt }
        ],
        evidence,
        trustedSource,
        confidence,
        resolved: resolvedValue
      });
      updatedAssetNames.push(asset.name);

      await session.run(
        `MATCH (n) WHERE id(n) = $id SET n.last_patched = $patchDate, n.last_seen = $lastSeen`,
        { id: neo4j.int(asset.id), patchDate: resolvedValue, lastSeen }
      );
    }

    const runId = "run-" + now;
    if (newAssetNames.length === 0 && updatedAssetNames.length === 0 && retiredAssetNames.length === 0) {
      return new Response(JSON.stringify({
        runId: null, newNodes: [], newEdges: [], retiredNodeIds: [],
        summary: { ranAt: lastSeen, newCount: 0, updatedCount: 0, retiredCount: 0, conflictCount: 0, conflicts: [], noOp: true }
      }), { headers: { "Content-Type": "application/json" } });
    }

    await session.run(
      `CREATE (r:DiscoveryRun {
        runId: $runId, ranAt: $ranAt, mode: "agentic",
        sourcesConsulted: $sources, newAssetCount: $newCount,
        updatedAssetCount: $updatedCount, retiredAssetCount: $retiredCount,
        conflictCount: $conflictCount, conflictsJson: $conflictsJson,
        newAssetNames: $newAssetNames, updatedAssetNames: $updatedAssetNames, retiredAssetNames: $retiredAssetNames
      })`,
      {
        runId, ranAt: lastSeen, sources: SOURCES,
        newCount: newAssetNames.length, updatedCount: updatedAssetNames.length, retiredCount: retiredAssetNames.length,
        conflictCount: conflicts.length, conflictsJson: JSON.stringify(conflicts),
        newAssetNames, updatedAssetNames, retiredAssetNames
      }
    );

    return new Response(JSON.stringify({
      runId, newNodes: newNodesForClient, newEdges: newEdgesForClient, retiredNodeIds,
      summary: {
        ranAt: lastSeen, newCount: newAssetNames.length, updatedCount: updatedAssetNames.length,
        retiredCount: retiredAssetNames.length, conflictCount: conflicts.length, conflicts
      }
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  } finally {
    await session.close();
    await driver.close();
  }
};

export const config: Config = {
  path: "/api/run-discovery-agentic"
};
