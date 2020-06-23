'use strict';

const gulp = require('gulp');
const path = require('path');
const webpack = require('webpack');
const build = require('@microsoft/sp-build-web');
const bundleAnalyzer = require('webpack-bundle-analyzer');
const log = require('fancy-log');
const fs = require('fs');
const colors = require('colors');

const readJson = (path, cb) => {
  fs.readFile(require.resolve(path), (err, data) => {
    if (err)
      log.error(err)
    else
      cb(null, JSON.parse(data))
  });
}

build.addSuppression(/^Warning - \[sass\].*$/);

// Retrieve the current build config and check if there is a `warnoff` flag set
const crntConfig = build.getConfig();
const warningLevel = crntConfig.args["warnoff"];

// Extend the SPFx build rig, and overwrite the `shouldWarningsFailBuild` property
if (warningLevel) {
  class CustomSPWebBuildRig extends build.SPWebBuildRig {
    setupSharedConfig() {
      build.log("IMPORTANT: Warnings will not fail the build.")
      build.mergeConfig({
        shouldWarningsFailBuild: false
      });
      super.setupSharedConfig();
    }
  }

  build.rig = new CustomSPWebBuildRig();
}

const envCheck = build.subTask('environmentCheck', (gulp, config, done) => {

  if (!config.production) {
      //https://spblog.net/post/2019/09/18/spfx-overclockers-or-how-to-significantly-improve-your-sharepoint-framework-build-performance#h_296972879501568737888136
      log(`[${colors.cyan('configure-webpack')}] Turning off ${colors.cyan('tslint')}...`);
      build.tslintCmd.enabled = false;
  }

  build.configureWebpack.mergeConfig({
    additionalConfiguration: (generatedConfiguration) => {

      fs.writeFileSync("./temp/_webpack_config.json", JSON.stringify(generatedConfiguration, null, 2));

      generatedConfiguration.resolve.alias = { handlebars: 'handlebars/dist/handlebars.min.js' };

      generatedConfiguration.node = {
        fs: 'empty'
      }

      generatedConfiguration.module.rules.push(
        { 
          test: /utils\.js$/, 
          loader: 'unlazy-loader', 
          include: [
              /node_modules/,
          ]
        }
      );
      
      // Exclude moment.js locale for performance purpose
      generatedConfiguration.plugins.push(
        new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/)
      );
  
      if (config.production) {
        const lastDirName = path.basename(__dirname);
        const dropPath = path.join(__dirname, 'temp', 'stats');
        generatedConfiguration.plugins.push(new bundleAnalyzer.BundleAnalyzerPlugin({
          openAnalyzer: false,
          analyzerMode: 'static',
          reportFilename: path.join(dropPath, `${lastDirName}.stats.html`),
          generateStatsFile: true,
          statsFilename: path.join(dropPath, `${lastDirName}.stats.json`),
          logLevel: 'error'
        }));
      }

      return generatedConfiguration;
    }
  });

  done();
});

build.rig.addPreBuildTask(envCheck);

const argv = build.rig.getYargs().argv;
const useCustomServe = argv['custom-serve'];
const workbenchApi = require("@microsoft/sp-webpart-workbench/lib/api");

if (useCustomServe) {
  const ensureWorkbenchSubtask = build.subTask('ensure-workbench-task', function (gulp, buildOptions, done) {
    this.log('Creating workbench.html file...');
    try {
      workbenchApi.default["/workbench"]();
    } catch (e) { }

    done();
  });

  build.rig.addPostBuildTask(build.task('ensure-workbench', ensureWorkbenchSubtask));
}

build.initialize(gulp);

gulp.task('update-version', async () => {

    const semver = require('semver')
    const versionArgIdx = process.argv.indexOf('--value');
    const newVersionNumber = semver.valid(process.argv[versionArgIdx+1]);

    if (versionArgIdx !== -1 && newVersionNumber) {
        
        // Update version in the package-solution
        const pkgSolutionFilePath = './config/package-solution.json';
        readJson(pkgSolutionFilePath, (err, pkgSolution) => {
          log.info('Old package-solution.json version:\t' + pkgSolution.solution.version);
          const pkgVersion = `${semver.major(newVersionNumber)}.${semver.minor(newVersionNumber)}.${semver.patch(newVersionNumber)}.0`;
          pkgSolution.solution.version = pkgVersion
          log.info('New package-solution.json version:\t' + pkgVersion);
          fs.writeFile(pkgSolutionFilePath, JSON.stringify(pkgSolution, null, 4), (error) => {});  
        });
    } else {
        log.error(`The provided version ${process.argv[versionArgIdx+1]} is not a valid SemVer version`);
    }
});


