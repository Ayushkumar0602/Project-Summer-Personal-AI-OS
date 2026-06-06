// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SummerApp",
    platforms: [
        .iOS(.v17)
    ],
    products: [
        .library(
            name: "SummerApp",
            targets: ["SummerApp"]
        ),
    ],
    targets: [
        .target(
            name: "SummerApp",
            path: "SummerApp"
        ),
    ]
)
