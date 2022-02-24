<p align="center">
  <a href="https://github.com/actions/typescript-action/actions"><img alt="typescript-action status" src="https://github.com/actions/typescript-action/workflows/build-test/badge.svg"></a>
</p>

# Pipe to Release

We made this repository because we had some trouble with other existing repos like [upload-release-action](https://github.com/svenstaro/upload-release-action/blob/master/src/main.ts) that were just no longer maintained and couldn't upload multiple files.

<br>


## Options
Heres a list of all the options you can include into the with block.

| name         | description                                                                                 | required | default                     |
| ------------ | ------------------------------------------------------------------------------------------- | -------- | --------------------------- |
| token        | The token this action uses to contact the github api.                                       | true     | none                        |
| repository   | The repository where the release will be created it.                                        | false    | active repository           |
| filemap      | The list of files that will be uploaded. See <a href="#file-piper">FilePiper</a> for more information. | true     | none                        |
| skip_errors  | If true, the action will skip errors instead of setting the build to failed.                | false    | true                        |
| draft        | If true, the action will create a draft release. (Not published)                            | false    | true                        |
| prerelease   | If true, the action will creae a prerelease.                                                | false    | false                       |
| overwrite    | If true, the action will update already existing assets instead of throwing an error        | false    | false                       |
| tag          | The tag of the release.                                                                     | false    | mytag                       |
| release_name | The name of the release.                                                                    | false    | My cool release             |
| release_body | The body (description) of the release.                                                      | false    | This is a very cool release |

<br>

## Usage
Basic multiple file upload:
```yaml
- name: Upload files to release
  uses: KotwOSS/upload-to-release@v1
  with:
    repo_token: ${{ secrets.GITHUB_TOKEN }}

    # The files that will be uploaded. Use > to specify the file source and the asset name
    filemap: |
      target/release/mything>mything
      target/release/someother>someother

    # Skip errors (doesn't fatal exit, just skips)
    skip_errors: true

    # Creates a release that is not published
    draft: true
    
    # Creates a prerelease
    prerelease: true

    # Replaces assets with the same name instead of throwing an error
    overwrite: true

    # Specifies the tag
    tag: ${{ github.ref }}

    # Specifies the name and the body content of the release
    release_name: This is my release
    release_body: "This is my release text"

    # Specifies a custom repository. (If not set the active repository will be used)
    repository: User/Repository
```

<br>

Multiple file upload with automated tag and release_name:
```yaml
- name: Generate commit hash
  id: commithash
  run: echo "::set-output name=sha_short::$(git rev-parse --short HEAD)"

- name: Generate build number
  id: buildnumber
    uses: einaregilsson/build-number@v3 
    with:
      token: ${{secrets.GITHUB_TOKEN}}

- name: Upload files to release
  uses: KotwOSS/upload-to-release@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}

    filemap: |
      target/release/mything>mything
      target/release/someother>someother

    skip_errors: true

    draft: true
    prerelease: true

    tag: "build_${{ env.BUILD_NUMBER }}"

    release_name: "build:${{ steps.commithash.outputs.sha_short }}"
    release_body: "This is an automated build"
```

<br>

Multiple file upload with automated tag and release_name with matrix:
```yaml
jobs:
  prepare:
    runs-on: ubuntu-latest
    outputs:
      BUILD_ID: ${{ steps.buildnumber.outputs.build_number }}
      SHA_SHORT: ${{ steps.commithash.outputs.sha_short }}

    steps:
      - uses: actions/checkout@v2
      
      - name: Set outputs
        id: commithash
        run: echo "::set-output name=sha_short::$(git rev-parse --short HEAD)"
      
      - name: Generate build number
        id: buildnumber
        uses: einaregilsson/build-number@v3 
        with:
          token: ${{ secrets.github_token }}
          

  buildMatrix:
    name: Publish for ${{ matrix.os }}
    runs-on: ${{ matrix.os }}
  
    strategy:
        fail-fast: false
        matrix:
          include:
          - os: ubuntu-latest
            filemap: |
              target/release/some.deb>some.deb
              target/release/some.AppImage>some.AppImage
                         
          - os: windows-latest
            filemap: |
              target/release/some.exe>some.exe
            
          - os: macos-latest
            filemap: |
              target/release/some.app>some.app
              target/release/some.dmg>some.dmg

    needs: prepare

    steps:
    - uses: actions/checkout@v2

    - name: Upload files to release
      uses: KotwOSS/upload-to-release@v1
      with:
        token: ${{ secrets.GITHUB_TOKEN }}

        filemap: ${{ matrix.filemap }}

        skip_errors: true

        draft: true
        prerelease: true

        tag: "build_${{ needs.prepare.outputs.BUILD_ID }}"
        release_name: "build:${{ needs.prepare.outputs.SHA_SHORT }}"
        release_body: "This is an automated build"
```


<br>

<a name="file-piper">

## File Piper

</a>

File pipers are a combination of `<source>`, `>` and `<dest>` which specify where a file should go.

<br>

### Examples

Pipe file `a` to file `b` -> `a>b` 

Pipe file `a>` to file `b>` (escaping `>` with `\>`) -> `a\>>b\>`