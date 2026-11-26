pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenLocal()
        maven {
            name = "GrimoirePackages"
            url = uri("https://maven.pkg.github.com/Operation-Grimoire/grimoire")
            content { includeGroupByRegex("io\\.grimoire(\\..*)?") }
            credentials {
                username = System.getenv("GITHUB_ACTOR") ?: ""
                password = System.getenv("GITHUB_TOKEN") ?: ""
            }
        }
        maven {
            name = "ExtensionsApiPackages"
            url = uri("https://maven.pkg.github.com/Operation-Grimoire/grimoire-extensions-api")
            content { includeGroupByRegex("io\\.grimoire(\\..*)?") }
            credentials {
                username = System.getenv("GITHUB_ACTOR") ?: ""
                password = System.getenv("GITHUB_TOKEN") ?: ""
            }
        }
        maven {
            name = "BrowserSessionsPackages"
            url = uri("https://maven.pkg.github.com/Operation-Grimoire/browser-sessions")
            content { includeGroupByRegex("io\\.grimoire(\\..*)?") }
            credentials {
                username = System.getenv("GITHUB_ACTOR") ?: ""
                password = System.getenv("GITHUB_TOKEN") ?: ""
            }
        }
        mavenCentral()
    }
}

rootProject.name = "grimoire-sidecar"
