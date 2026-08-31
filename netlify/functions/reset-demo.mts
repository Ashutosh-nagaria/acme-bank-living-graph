import type { Context, Config } from "@netlify/functions";
import neo4j from "neo4j-driver";

const CANDIDATE_NAMES = ["Compliance Reporting Service", "Fraud Analytics Service", "Cache Layer", "DR-LB", "APP-SRV-05"];

export default async (req: Request, context: Context) => {
  const uri = Netlify.env.get("NEO4J_URI");
  const username = Netlify.env.get("NEO4J_USERNAME");
  const password = Netlify.env.get("NEO4J_PASSWORD");

  if (!uri || !username || !password) {
    return new Response(JSON.stringify({ error: "Missing Neo4j credentials" }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  const session = driver.session();

  try {
    const poolResult = await session.run(
      `MATCH (n) WHERE n.name IN $names DETACH DELETE n RETURN count(n) AS deletedCount`,
      { names: CANDIDATE_NAMES }
    );
    const deletedPoolCount = poolResult.records[0].get("deletedCount").toNumber();

    const logResult = await session.run(
      `MATCH (r:DiscoveryRun) DETACH DELETE r RETURN count(r) AS deletedCount`
    );
    const deletedLogCount = logResult.records[0].get("deletedCount").toNumber();

    return new Response(JSON.stringify({
      status: "reset complete",
      discoveredAssetsRemoved: deletedPoolCount,
      discoveryRunsRemoved: deletedLogCount,
      note: "Original 19-node topology untouched"
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
  path: "/api/reset-demo"
};
