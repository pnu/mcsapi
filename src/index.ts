import functions from "@google-cloud/functions-framework";
import compute from "@google-cloud/compute";
import express from "express";
import { Request, Response } from "express";
import mc from "minecraftstatuspinger";

const instancesClient = new compute.InstancesClient();
const zoneOperationsClient = new compute.ZoneOperationsClient();
const project = await instancesClient.getProjectId();

const app = express();
app.use("/vm-start", vmStartFunc);
app.use("/vm-stop", vmStopFunc);
app.use("/vm-restart", vmRestartFunc);
app.use("/vm-status", vmStatusFunc);
app.use("/mcs-status", mcsStatusFunc);
app.use("/mcs-player-count", mcsPlayersFunc);
app.use("/mcs-player-list", mcsPlayerListFunc);

functions.http("api", app);

function reqZoneInstance(req: Request) {
  const zone = req.query.zone || req.body.zone;
  const instance = req.query.instance || req.body.instance;
  if (!zone) throw new Error("Required parameter 'zone' missing");
  if (!instance) throw new Error("Required parameter 'instance' missing");
  return [zone, instance];
}

async function vmStartFunc(req: Request, res: Response) {
  try {
    const [zone, instance] = reqZoneInstance(req);
    console.info(`Start ${zone}/${instance}`);
    await startInstance(zone, instance);
    res.send(await vmStatusString(zone, instance));
  } catch (err: any) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
}

async function vmStopFunc(req: Request, res: Response) {
  try {
    const [zone, instance] = reqZoneInstance(req);
    console.info(`Stop ${zone}/${instance}`);
    await stopInstance(zone, instance);
    res.send(await vmStatusString(zone, instance));
  } catch (err: any) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
}

async function vmRestartFunc(req: Request, res: Response) {
  try {
    const [zone, instance] = reqZoneInstance(req);
    console.info(`Restart ${zone}/${instance}`);
    await stopInstance(zone, instance);
    await startInstance(zone, instance);
    res.send(await vmStatusString(zone, instance));
  } catch (err: any) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
}

async function vmStatusFunc(req: Request, res: Response) {
  try {
    const [zone, instance] = reqZoneInstance(req);
    console.info(`Get ${zone}/${instance}`);
    res.send(await vmStatusString(zone, instance));
  } catch (err: any) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
}

async function mcsStatusFunc(req: Request, res: Response) {
  try {
    const [zone, instance] = reqZoneInstance(req);
    const ip = await getVmIP(zone, instance);
    console.info(`Get MCS ${ip}`);
    const mcsStatus = await mc.lookup({ host: ip });
    res.contentType("application/json");
    res.send(JSON.stringify(mcsStatus, null, 2) + "\n");
  } catch (err: any) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
}

async function mcsPlayersFunc(req: Request, res: Response) {
  try {
    const [zone, instance] = reqZoneInstance(req);
    const ip = await getVmIP(zone, instance);
    console.info(`Get MCS ${ip} number of players`);
    const mcsStatus = await mc.lookup({ host: ip });
    const playersCount = parseInt(mcsStatus?.status?.players?.online);
    res.send(`${playersCount}\n`);
  } catch (err: any) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
}

async function mcsPlayerListFunc(req: Request, res: Response) {
  try {
    const [zone, instance] = reqZoneInstance(req);
    const ip = await getVmIP(zone, instance);
    console.info(`Get MCS ${ip} player list`);
    const mcsStatus = await mc.lookup({ host: ip });
    const playersList: Array<any> = mcsStatus?.status?.players?.sample;
    const userList = playersList.map((player) => `${player.name} ${player.id}`);
    res.send(userList.join("\n") + "\n");
  } catch (err: any) {
    console.error(err);
    res.status(500).send("Error: " + err.message);
  }
}

async function startInstance(zone: string, instance: string) {
  const [operation] = await instancesClient.start({
    project,
    zone,
    instance,
  });
  const opName = operation.latestResponse.name;
  await waitForComputeIOperation(project, zone, opName);
}

async function stopInstance(zone: string, instance: string) {
  const [operation] = await instancesClient.stop({
    project,
    zone,
    instance,
  });
  const opName = operation.latestResponse.name;
  await waitForComputeIOperation(project, zone, opName);
}

async function vmStatusString(zone: string, instance: string) {
  const arr = await getVmInstance(zone, instance);
  return arr.filter((x) => x).join("\n") + "\n";
}

async function getVmIP(zone: string, instance: string) {
  const [ip, _] = await getVmInstance(zone, instance);
  if (!ip)
    throw new Error(
      `Instance ${zone}/${instance} IP address not found - unable to connect MCS`
    );
  return ip;
}

async function getVmInstance(zone: string, instance: string) {
  const [inst] = await instancesClient.get({
    project,
    zone,
    instance,
  });
  const ip =
    inst?.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || undefined;
  const status = inst.status || undefined;
  return [ip, status];
}

async function waitForComputeIOperation(
  project: string,
  zone: string,
  operation: string
) {
  while (true) {
    console.debug(`Waiting ${operation} ...`);
    const [iOp] = await zoneOperationsClient.wait({
      operation,
      project,
      zone,
    });
    if (iOp.statusMessage) console.error(`Status: ${iOp.statusMessage}`);
    if (iOp.warnings && iOp.warnings.length > 0)
      console.warn(`Warnings: ${iOp.warnings.join(", ")}`);
    if (iOp.status === "DONE") break;
  }
  console.debug(`Done ${operation}`);
}
