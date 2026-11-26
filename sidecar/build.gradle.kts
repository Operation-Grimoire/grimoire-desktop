plugins {
    kotlin("jvm") version "2.2.10"
    application
}

val extensionsApiVersion = providers.gradleProperty("extensionsApiVersion").orElse("1.6.0")
val readingCoreVersion = providers.gradleProperty("readingCoreVersion").orElse("1.0.0-SNAPSHOT")
val jsonVersion = "20240303"

kotlin {
    compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11)
}
java {
    sourceCompatibility = JavaVersion.VERSION_11
    targetCompatibility = JavaVersion.VERSION_11
}

allprojects {
    configurations.all {
        resolutionStrategy.cacheChangingModulesFor(0, "seconds")
    }
}

dependencies {
    implementation("io.grimoire:reading-core:${readingCoreVersion.get()}")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.json:json:$jsonVersion") {
        version { strictly(jsonVersion) }
    }
    implementation("org.xerial:sqlite-jdbc:3.54.1.0")
    testImplementation("junit:junit:4.13.2")
}

application {
    mainClass.set("io.grimoire.desktop.DaemonMainKt")
}

tasks.processResources {
    inputs.property("hostApi", extensionsApiVersion)
    inputs.property("jsonVersion", jsonVersion)
    val api = extensionsApiVersion.get()
    val jsonCoord = "org.json:json:$jsonVersion"
    filesMatching("host.properties") {
        expand("apiVersion" to api, "jsonCoordinate" to jsonCoord)
    }
}
