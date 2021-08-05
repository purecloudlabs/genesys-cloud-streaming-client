@Library('pipeline-library') _

webappPipeline {
    slaveLabel = 'dev_v2'
    nodeVersion = '14.17.0'
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
            testResults: 'https://jenkins.ininica.com/job/spigot-tests-streaming-client-test/',
            qaId: '5d41d9195ca9700dac0ef53a'
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
