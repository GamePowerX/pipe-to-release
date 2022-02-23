import * as fs from "fs";
import {Octokit} from "@octokit/core";
import {Endpoints} from "@octokit/types";
import * as core from "@actions/core";
import * as github from "@actions/github";
import * as path from "path";

function getInputBoolRequired(name: string) {
    return core.getInput(name, {required: true}) === "true";
}

function getInputBool(name: string, def: boolean) {
    let ip = core.getInput(name);
    return ip === undefined ? def : (ip === "true");
}

function getInputStringRequired(name: string) {
    return core.getInput(name, {required: true});
}

function getInputString(name: string, def: string) {
    let ip = core.getInput(name);
    return ip === undefined ? def : ip;
}

function getInputArrayRequired(name: string) {
    return core.getMultilineInput(name, {required: true});
}

function getInputArray(name: string) {
    return core.getMultilineInput(name);
}

function getInputRepository(name: string, def: any) {
    let ip = core.getInput(name);
    if(ip === undefined) return def;
    let split = ip.split("/");
    return {owner: split[0], repo: split[1]};
}



async function main() {
    const githubToken = getInputStringRequired("repo_token");

    // File map
    const fileMap = getInputArrayRequired("filemap");

    // Release stuff
    const release_name = getInputString("release_name", "My cool release");
    const release_body = getInputString("release_body", "This is a very cool release");
    const prerelease = getInputBool("prerelease", false);
    const draft = getInputBool("draft", true);
    const tag = getInputString("tag", "mytag");

    // Misc stuff
    const overwrite = getInputBool("overwrite", false);

    // Repository stuff
    const repository = getInputRepository("repository", github.context.repo);
    
    const octokit = github.getOctokit(githubToken);

    core.debug("Looking for release...");
    const release = getOrCreateRelease(repository, tag, prerelease, draft, release_name, release_body, octokit);

}

async function getOrCreateRelease(repository: any, tag: string, prerelease: boolean, draft: boolean, release_name: string, release_body: string, octokit: Octokit) {
    let result = await octokit.request("GET /repos/{owner}/{repo}/releases/tags/{tag}", {
        ...repository,
        tag: tag
    });

    if(result.status === 200) {
        core.debug("Found release (id: " + result.data.id + ")!");
        return result;
    } else {
        core.debug("Release not found! Creating it...");
        return (await octokit.request("POST /repos/{owner}/{repo}/releases", {
            ...repository,
            tag_name: tag,
            name: release_name,
            body: release_body,
            prerelease: prerelease,
            draft: draft
        }));
    }
}

async function uploadToRelease(repository: any, release: any, file: string, name: string, tag: string, overwrite: boolean, octokit: Octokit) {
    const stat = fs.statSync(file);
    if(stat.isFile()) {
        let assets = await octokit.request('GET /repos/{owner}/{repo}/releases/{release_id}/assets', {
            ...repository,
            release_id: release.data.id
        });

        if(assets.status === 200) {
            let duplicateAsset = assets.data.filter(asset=>asset.name === name)[0];
            if(duplicateAsset) {
                if(overwrite) {
                    
                } else core.warning("duplicate without overwrite=true. Skipping file...");
            }
        } else core.warning("couldn't list all release assets! Skipping file...");
    } else core.warning("skipped file '" + file + "' since its not found or not a file.");
}

type RepoAssetsResp = Endpoints["GET /repos/:owner/:repo/releases/:release_id/assets"]["response"]["data"]
type ReleaseByTagResp = Endpoints["GET /repos/:owner/:repo/releases/tags/:tag"]["response"]
type CreateReleaseResp = Endpoints["POST /repos/:owner/:repo/releases"]["response"]
type UploadAssetResp = Endpoints["POST /repos/:owner/:repo/releases/:release_id/assets{?name,label}"]["response"]


async function upload_to_release(
  release: ReleaseByTagResp | CreateReleaseResp,
  file: string,
  asset_name: string,
  tag: string,
  overwrite: boolean,
  octokit: Octokit
): Promise<undefined | string> {
  const stat = fs.statSync(file)
  if (!stat.isFile()) {
    core.debug(`Skipping ${file}, since its not a file`)
    return
  }
  const file_size = stat.size
  const file_bytes = fs.readFileSync(file)

  // Check for duplicates.
  const assets: RepoAssetsResp = await octokit.paginate(
    octokit.repos.listReleaseAssets,
    {
      ...repo(),
      release_id: release.data.id
    }
  )
  const duplicate_asset = assets.find(a => a.name === asset_name)
  if (duplicate_asset !== undefined) {
    if (overwrite) {
      core.debug(
        `An asset called ${asset_name} already exists in release ${tag} so we"ll overwrite it.`
      )
      await octokit.repos.deleteReleaseAsset({
        ...repo(),
        asset_id: duplicate_asset.id
      })
    } else {
      core.setFailed(`An asset called ${asset_name} already exists.`)
      return duplicate_asset.browser_download_url
    }
  } else {
    core.debug(
      `No pre-existing asset called ${asset_name} found in release ${tag}. All good.`
    )
  }

  core.debug(`Uploading ${file} to ${asset_name} in release ${tag}.`)
  const uploaded_asset: UploadAssetResp = await octokit.repos.uploadReleaseAsset(
    {
      url: release.data.upload_url,
      name: asset_name,
      data: file_bytes,
      headers: {
        "content-type": "binary/octet-stream",
        "content-length": file_size
      }
    }
  )
  return uploaded_asset.data.browser_download_url
}

function repo(): {owner: string; repo: string} {
  const repo_name = core.getInput("repo_name")
  // If we"re not targeting a foreign repository, we can just return immediately and don"t have to do extra work.
  if (!repo_name) {
    return github.context.repo
  }
  const owner = repo_name.substr(0, repo_name.indexOf("/"))
  if (!owner) {
    throw new Error(`Could not extract "owner" from "repo_name": ${repo_name}.`)
  }
  const repo = repo_name.substr(repo_name.indexOf("/") + 1)
  if (!repo) {
    throw new Error(`Could not extract "repo" from "repo_name": ${repo_name}.`)
  }
  return {
    owner,
    repo
  }
}

async function run(): Promise<void> {
  try {
    // Get the inputs from the workflow file: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
    const token = core.getInput("repo_token", {required: true})
    const file = core.getInput("file", {required: true})
    const tag = core
      .getInput("tag", {required: true})
      .replace("refs/tags/", "")
      .replace("refs/heads/", "")

    const file_glob = core.getInput("file_glob") == "true" ? true : false
    const overwrite = core.getInput("overwrite") == "true" ? true : false
    const prerelease = core.getInput("prerelease") == "true" ? true : false
    const release_name = core.getInput("release_name")
    const body = core.getInput("body")

    const octokit: Octokit = github.getOctokit(token)
    const release = await get_release_by_tag(
      tag,
      prerelease,
      release_name,
      body,
      octokit
    )

    if (file_glob) {
      const files = glob.sync(file)
      if (files.length > 0) {
        for (const file of files) {
          const asset_name = path.basename(file)
          const asset_download_url = await upload_to_release(
            release,
            file,
            asset_name,
            tag,
            overwrite,
            octokit
          )
          core.setOutput("browser_download_url", asset_download_url)
        }
      } else {
        core.setFailed("No files matching the glob pattern found.")
      }
    } else {
      const asset_name =
        core.getInput("asset_name") !== ""
          ? core.getInput("asset_name").replace(/\$tag/g, tag)
          : path.basename(file)
      const asset_download_url = await upload_to_release(
        release,
        file,
        asset_name,
        tag,
        overwrite,
        octokit
      )
      core.setOutput("browser_download_url", asset_download_url)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()