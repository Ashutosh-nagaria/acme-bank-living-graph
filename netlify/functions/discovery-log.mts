import type { Context, Config } from "@netlify/functions";
import neo4j from "neo4j-driver";

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
    const result = await session.run(
      `MATCH (r:DiscoveryRun) RETURN r ORDER BY r.ranAt DESC LIMIT 10`
    );

    const runs = result.records.map(rec => {
      const p = rec.get("r").properties;
      return {
        runId: p.runId,
        ranAt: p.ranAt,
        mode: p.mode,
        sourcesConsulted: p.sourcesConsulted,
        newAssetCount: neo4j.isInt(p.newAssetCount) ? p.newAssetCount.toNumber() : p.newAssetCount,
        updatedAssetCount: neo4j.isInt(p.updatedAssetCount) ? p.updatedAssetCount.toNumber() : p.updatedAssetCount,
        conflictCount: neo4j.isInt(p.conflictCount) ? p.conflictCount.toNumber() : p.conflictCount,
        conflicts: JSON.parse(p.conflictsJson || "[]"),
        newAssetNames: p.newAssetNames || [],
        updatedAssetNames: p.updatedAssetNames || []
      };
    });

    return new Response(JSON.stringify({ runs }), {
      headers: { "Content-Type": "application/json" }
    });
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
  path: "/api/discovery-log"
};
