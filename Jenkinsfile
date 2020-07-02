@Library('pipeline-library@webapp-pipelines') _

webappPipeline {
    slaveLabel = 'dev_v2'
    nodeVersion = '10.16.2'
    useArtifactoryRepo = false
    projectName = 'developercenter-cdn/streaming-client'
    manifest = directoryManifest('dist')
    buildType = { env.BRANCH_NAME == 'master' ? 'MAINLINE' : 'FEATURE' }
    publishPackage = { 'prod' }
    testJob = 'valve-hawk-tests'

    buildStep = {
        sh('npm i && npm test && npm run build')
    }

    cmConfig = {
        return [
            managerEmail: 'purecloud-client-media@genesys.com',
            rollbackPlan: 'Patch version with fix',

            // TODO: kick off a prepublish build of web-directory and link to tests run
            // against that feature build
            testResults: 'https://jenkins.ininica.com/job/valve-hawk-tests-test/'
        ]
    }

    shouldTagOnRelease = { false }

    postReleaseStep = {
        sshagent(credentials: [constants.credentials.github.inin_dev_evangelists]) {
            sh("""
                git tag v${version}
                git push origin --tags
            """)
        }
    }
}
