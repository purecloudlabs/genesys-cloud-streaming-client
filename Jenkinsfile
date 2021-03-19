@Library('pipeline-library@post-release-step-creds-for-github') _

webappPipeline {
    slaveLabel = 'dev_v2'
    nodeVersion = '10.16.2'
    useArtifactoryRepo = false
    projectName = 'developercenter-cdn/streaming-client'
    manifest = directoryManifest('dist')
    buildType = { env.BRANCH_NAME == 'master' ? 'MAINLINE' : 'FEATURE' }
    publishPackage = { 'prod' }
    testJob = null

    buildStep = {
        sh('npm ci && npm test && npm run build')
    }

    snykConfig = {
        return [
            organization: 'genesys-client-media-webrtc',
        ]
    }

    cmConfig = {
        return [
            managerEmail: 'purecloud-client-media@genesys.com',
            rollbackPlan: 'Patch version with fix',

            // TODO: kick off a prepublish build of web-directory and link to tests run
            // against that feature build
            testResults: 'https://jenkins.ininica.com/job/spigot-tests-streaming-client-test/'
        ]
    }

    shouldTagOnRelease = { true }

    // postReleaseStep = {
    //     sshagent(credentials: [constants.credentials.github.inin_dev_evangelists]) {
    //         sh("""
    //             git tag v${version}
    //             git push origin --tags
    //         """)
    //     }
    // }
}
