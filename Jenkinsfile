@Library('pipeline-library@webapp-pipelines') _

webappPipeline {
    slaveLabel = 'dev'
    nodeVersion = '10.16.2'
    useArtifactoryRepo = false
    projectName = 'purecloud-streaming-client'
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

    shouldTagOnRelease = { true }

    postReleaseStep = {
        sh("""
            # patch to prep for the next version
            npm version patch --no-git-tag-version
            git commit -am "Prep next version"
            git push origin HEAD:master --tags
        """)
    }
}