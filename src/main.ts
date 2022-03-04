import * as fs from "fs";
import { Octokit } from "@octokit/core";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { exit } from "process";

// Gets a input bool with a default value
function getInputBool(name: string, def: boolean) {
    const ip = core.getBooleanInput(name);
    return ip === undefined ? def : ip;
}

// Gets a required input string
function getInputStringRequired(name: string) {
    return core.getInput(name, { required: true });
}

// Gets a input string with a default value
function getInputString(name: string, def: string) {
    const ip = core.getInput(name);
    return ip === undefined || ip.trim() === "" ? def : ip;
}

// Gets a required multiline input
function getInputArrayRequired(name: string) {
    return core.getMultilineInput(name, { required: true });
}

// Gets a repository from the input (format owner/repo)
function getInputRepository(name: string, def: any) {
    const ip = core.getInput(name);
    if (ip === undefined || ip.trim() === "") return def;
    const split = ip.split("/");
    if (split.length !== 2) error(`Repository must be in format owner/repo! (${ip})`);
    return { owner: split[0], repo: split[1] };
}

const ERR_HANDLED = "ERR_HANDLED";

let skipErrors = true;

// Error handler
function error(msg: string, throwError = true) {
    if (skipErrors) {
        core.error(`Skipping error '${msg}'! If you want to disable error skipping: 'skip_errors: false'`);
        if (throwError) throw ERR_HANDLED;
    } else {
        core.setFailed(`Error occured '${msg}'! If you want to enable error skipping: 'skip_errors: true'`);
        exit(1);
    }
}

// Main loop
async function main() {
    const githubToken = getInputStringRequired("token");

    // File map
    const fileMap = getInputArrayRequired("filemap");

    // Release stuff
    const release_name = getInputString("release_name", "My cool release");
    const release_body = getInputString("release_body", "This is a very cool release");
    const prerelease = getInputBool("prerelease", false);
    const draft = getInputBool("draft", true);
    const tag = getInputString("tag", "mytag");
    skipErrors = getInputBool("skip_errors", true);

    // Misc stuff
    const overwrite = getInputBool("overwrite", false);

    // Repository stuff
    const repository = getInputRepository("repository", github.context.repo);

    const octokit = github.getOctokit(githubToken);

    core.info("Looking for release...");
    const release = getOrCreateRelease(repository, tag, prerelease, draft, release_name, release_body, octokit);

    fileMap.forEach((line, id) => {
        try {
            const { source, dest } = replaceTag(parseFilePiper(line), tag);
            core.info(`Trying to upload file '${source}' to '${dest}'`);
            uploadToRelease(repository, release, source, dest, tag, overwrite, octokit);
        } catch (e: any) {
            if (e !== ERR_HANDLED) error(`Error while parsing filePiper (${id}:'${line}'). Message: '${e.message}'`, false);
        }
    });
}

// Replaces $tag to the tag of the file piper output
function replaceTag(piperOutput: any, tag: string) {
    return {
        source: piperOutput.source.replace(/\$tag/g, tag),
        dest: piperOutput.dest.replace(/\$tag/g, tag)
    };
}

// Parses a file piper
function parseFilePiper(line: string) {
    let source = "";
    let dest = "";

    let state = false;
    let buf = "";
    let escape = false;
    for (const c of line) {
        if (escape) {
            escape = false;
            buf += c;
        } else {
            if (c === "\\") escape = true;
            else if (c === ">") {
                if (state) throw new Error("cannot have 2 '>'! (If you meant to include '>' in the file path try using '\\>')");
                else {
                    source = buf;
                    buf = "";
                    state = true;
                }
            } else buf += c;
        }
    }

    if (state) {
        dest = buf;

        if (dest.trim() === "" || source.trim() === "") throw new Error("source or destination cannot be empty!");

        return { source, dest };
    } else throw new Error("must have 1 '>'!");
}

// Gets or creates (if not exists) a release
async function getOrCreateRelease(repository: any, tag: string, prerelease: boolean, draft: boolean, release_name: string, release_body: string, octokit: Octokit) {
    const result = await octokit.request("GET /repos/{owner}/{repo}/releases/tags/{tag}", {
        ...repository,
        tag
    });

    if (result.status === 200) {
        core.debug(`Found release (id: ${result.data.id}!`);
        return result;
    } else {
        core.debug("Release not found! Creating it...");
        return await octokit.request("POST /repos/{owner}/{repo}/releases", {
            ...repository,
            tag_name: tag,
            name: release_name,
            body: release_body,
            prerelease,
            draft
        });
    }
}

// Uploads a file to a release
async function uploadToRelease(repository: any, release: any, file: string, name: string, tag: string, overwrite: boolean, octokit: Octokit) {
    const stat = fs.statSync(file);
    if (stat.isFile()) {
        const assets = await octokit.request("GET /repos/{owner}/{repo}/releases/{release_id}/assets", {
            ...repository,
            release_id: release.data.id
        });

        if (assets.status === 200) {
            const duplicateAsset = assets.data.filter(asset => asset.name === name)[0];
            if (duplicateAsset) {
                if (overwrite) {
                    await octokit.request("DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}", {
                        ...repository,
                        asset_id: duplicateAsset.id
                    });
                } else error(`Duplicate asset without overwrite=true ('${file}' -> '${name}')`);
            }

            const data = fs.readFileSync(file);
            const data_size = stat.size;

            const asset = await octokit.request(`POST ${release.data.upload_url}`, {
                name,
                data,
                headers: {
                    "content-type": "binary/octet-stream",
                    "content-length": data_size
                }
            });

            if (asset.status === 201) {
                core.info(`Successfully uploaded ${file} (${asset.data.browser_download_url})!`);
                return asset.data.browser_download_url;
            } else error(`Failed to upload asset ('${file}' -> '${name}')`);
        } else error(`Couldn't list all release assets (github token invalid?) ('${file}' -> '${name}')`);
    } else error(`File doesn't exist, or is a directory ('${file}' -> '${name}')`);
}

// Call main loop
main();
