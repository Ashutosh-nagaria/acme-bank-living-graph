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

export default async (req: Request, context: Context) => {
  const uri = Netlify.env.get("NEO4J_URI");
  const username = Netlify.env.get("NEO4J_USERNAME");
  const password = Netlify.env.get("NEO4J_PASSWORD");

  if (!uri || !username || !password) {
    return new Response(JSON.stringify({ error: "Missing Neo4j credentials" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  const session = driver.session();

  try {
    const existingCheck = await session.run(
      `MATCH (n) WHERE n.name IN $names RETURN n.name AS name`,
      { names: CANDIDATE_POOL.map(c => c.name) }
    );
    const existingNames = new Set(existingCheck.records.map(r => r.get("name")));
    const undiscovered = CANDIDATE_POOL.filter(c => !existingNames.has(c.name));

    const newCount = Math.min(undiscovered.length, 1 + Math.floor(Math.random() * 3));
    const toDiscover = pickRandom(undiscovered, newCount);

    const conflicts: any[] = [];
    const newAssetNames: string[] = [];
    const updatedAssetNames: string[] = [];
    const newNodesForClient: any[] = [];
    const newEdgesForClient: any[] = [];

    const now = Date.now();
    const lastSeen = new Date(now).toISOString();

    for (const candidate of toDiscover) {
      const [sourceA, sourceB] = pickRandom(SOURCES, 2);
      let resolvedEnv = "production";
      let resolvedOwner = "Unassigned";
      let conflictRecord: any;

      if (Math.random() < 0.5) {
        const pairs = Math.random() < 0.5
          ? [{ src: sourceA, val: "staging" }, { src: sourceB, val: "production" }]
          : [{ src: sourceB, val: "staging" }, { src: sourceA, val: "production" }];
        const [older, newer] = pairs;
        resolvedEnv = newer.val;
        conflictRecord = {
          asset: candidate.name,
          field: "environment",
          rule: "most-recent-observation-wins",
          detail: `${older.src} reported "${older.val}" (older scan), ${newer.src} reported "${newer.val}" (more recent scan)`,
          resolved: newer.val
        };
      } else {
        const owners = ["Platform Engineering", "Payments Engineering", "SRE Team"];
        const owner = owners[Math.floor(Math.random() * owners.length)];
        const knowingSource = Math.random() < 0.5 ? sourceA : sourceB;
        const otherSource = knowingSource === sourceA ? sourceB : sourceA;
        resolvedOwner = owner;
        conflictRecord = {
          asset: candidate.name,
          field: "owner_team",
          rule: "fill-gap-from-available-source",
          detail: `${otherSource} did not report an owning team, ${knowingSource} reported "${owner}"`,
          resolved: owner
        };
      }

      conflicts.push(conflictRecord);
      newAssetNames.push(candidate.name);

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
        anchorName: candidate.anchor,
        name: candidate.name,
        env: resolvedEnv,
        owner: resolvedOwner,
        sources: `${sourceA} + ${sourceB}`,
        lastSeen
      });

      const rec = result.records[0];
      const n = rec.get("n");
      const r = rec.get("r");
      const anchor = rec.get("anchor");

      newNodesForClient.push({
        id: n.identity.toString(),
        label: n.properties.name,
        group: n.labels[0]
      });
      newEdgesForClient.push({
        id: r.identity.toString(),
        from: candidate.direction === "forward" ? n.identity.toString() : anchor.identity.toString(),
        to: candidate.direction === "forward" ? anchor.identity.toString() : n.identity.toString(),
        label: candidate.relType
      });
    }

    const allExisting = await session.run(`MATCH (n) WHERE NOT n:DiscoveryRun RETURN n.name AS name, id(n) AS id`);
    const existingList = allExisting.records.map(r => ({ name: r.get("name") as string, id: r.get("id").toString() }));
    const updateCount = Math.min(existingList.length, Math.floor(Math.random() * 3));
    const toUpdate = pickRandom(existingList, updateCount);

    for (const asset of toUpdate) {
      const [sourceA, sourceB] = pickRandom(SOURCES, 2);
      const patchDate = new Date(now - 1000 * 60 * 60 * 24 * Math.floor(Math.random() * 90)).toISOString().slice(0, 10);

      conflicts.push({
        asset: asset.name,
        field: "last_patched",
        rule: "most-recent-observation-wins",
        detail: `${sourceA} had no recent patch record on file, ${sourceB} confirmed a patch on ${patchDate}`,
        resolved: patchDate
      });
      updatedAssetNames.push(asset.name);

      await session.run(
        `MATCH (n) WHERE id(n) = $id SET n.last_patched = $patchDate, n.last_seen = $lastSeen`,
        { id: neo4j.int(asset.id), patchDate, lastSeen }
      );
    }

    const runId = "run-" + now;
    if (newAssetNames.length === 0 && updatedAssetNames.length === 0) {
      return new Response(JSON.stringify({
        runId: null,
        newNodes: [],
        newEdges: [],
        summary: { ranAt: lastSeen, newCount: 0, updatedCount: 0, conflictCount: 0, conflicts: [], noOp: true }
      }), { headers: { "Content-Type": "application/json" } });
    }

    await session.run(
      `CREATE (r:DiscoveryRun {
        runId: $runId, ranAt: $ranAt, mode: "non_agentic",
        sourcesConsulted: $sources, newAssetCount: $newCount,
        updatedAssetCount: $updatedCount, conflictCount: $conflictCount,
        conflictsJson: $conflictsJson, newAssetNames: $newAssetNames, updatedAssetNames: $updatedAssetNames
      })`,
      {
        runId, ranAt: lastSeen, sources: SOURCES,
        newCount: newAssetNames.length, updatedCount: updatedAssetNames.length,
        conflictCount: conflicts.length, conflictsJson: JSON.stringify(conflicts),
        newAssetNames, updatedAssetNames
      }
    );

    return new Response(JSON.stringify({
      runId,
      newNodes: newNodesForClient,
      newEdges: newEdgesForClient,
      summary: {
        ranAt: lastSeen,
        newCount: newAssetNames.length,
        updatedCount: updatedAssetNames.length,
        conflictCount: conflicts.length,
        conflicts
      }
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  } finally {
    await session.close();
    await driver.close();
  }
};

export const config: Config = {
  path: "/api/run-discovery"
};
