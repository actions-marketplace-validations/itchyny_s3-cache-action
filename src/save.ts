import * as core from "@actions/core";
import * as glob from "@actions/glob";
import * as fs from "fs";
import * as tar from "tar";

import { Inputs, State } from "./constants";
import { S3Client } from "./s3-client";
import { archivePath, fileName, fileSize, splitInput } from "./utils";

export async function save() {
  const path = splitInput(
    core.getState(State.CachePath) || core.getInput(Inputs.Path, { required: true }),
  );
  const key = core.getState(State.CacheKey) || core.getInput(Inputs.Key, { required: true });
  core.debug(`${Inputs.Path}: [${path.join(", ")}]`);
  core.debug(`${Inputs.Key}: ${key}`);

  const restoredKey = core.getState(State.CacheMatchedKey);
  if (restoredKey === key) {
    core.info(`Cache restored from S3 with key ${key}, not saving cache.`);
    return;
  }

  const client = new S3Client();
  const file = fileName(path);
  if (await client.headObject(key, file)) {
    core.info(`Cache found in S3 with key ${key}, not saving cache.`);
    return;
  }

  const paths = await glob
    .create(path.join("\n"), { implicitDescendants: false })
    .then((globber) => globber.glob());
  const archive = archivePath();
  try {
    core.debug(`Creating archive ${archive}.`);
    await tar.create({ file: archive, gzip: true, preservePaths: true }, paths);
    await client.putObject(key, file, fs.createReadStream(archive));
    core.info(`Cache saved to S3 with key ${key}, ${fileSize(archive)} bytes.`);
  } finally {
    try {
      core.debug(`Deleting archive ${archive}.`);
      fs.unlinkSync(archive);
    } catch (error: unknown) {
      if (error instanceof Error && !("code" in error && error.code === "ENOENT")) {
        core.debug(`Failed to delete archive: ${error}`);
      }
    }
  }
}

if (require.main === module) {
  (async () => {
    try {
      await save();
    } catch (error: unknown) {
      if (error instanceof Error) {
        core.setFailed(error);
      }
    }
  })();
}
