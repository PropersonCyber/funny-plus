import uuid, os
def oid(): return uuid.uuid4().hex[:24].upper()

files = ['FunnyPlus/main.m']
res = ['FunnyPlus/web', 'FunnyPlus/Assets.xcassets']

ids = {f: oid() for f in files}
bids = {f: oid() for f in files}
resids = {f: oid() for f in res}
resbids = {f: oid() for f in res}

proj = oid(); target = oid(); main_group = oid(); app_group = oid()
sources_phase = oid(); frameworks_phase = oid(); resources_phase = oid()
prod_group = oid(); products_target = oid(); cfglist_proj = oid(); cfglist_target = oid()
cfg_proj_d = oid(); cfg_proj_r = oid(); cfg_t_d = oid(); cfg_t_r = oid()

src_entries = '\n'.join(
    f'\t\t{bids[f]} /* {os.path.basename(f)} in Sources */ = {{isa = PBXBuildFile; fileRef = {ids[f]} /* {os.path.basename(f)} */; }};'
    for f in files)
src_files = '\n'.join(
    f'\t\t{ids[f]} /* {os.path.basename(f)} */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.c.objc; path = {os.path.basename(f)}; sourceTree = "<group>"; }};'
    for f in files)
res_entries = '\n'.join(
    f'\t\t{resbids[r]} /* {os.path.basename(r)} in Resources */ = {{isa = PBXBuildFile; fileRef = {resids[r]} /* {os.path.basename(r)} */; }};'
    for r in res)
res_files = '\n'.join(
    f'\t\t{resids[r]} /* {os.path.basename(r)} */ = {{isa = PBXFileReference; lastKnownFileType = {("folder.assetcatalog" if r.endswith("xcassets") else ("folder" if os.path.basename(r) == "web" else "file"))}; path = {os.path.basename(r)}; sourceTree = "<group>"; }};'
    for r in res)

pbx = f'''// !$*UTF8*$!
{{
	archiveVersion = 1;
	classes = {{}};
	objectVersion = 56;
	objects = {{

{src_entries}
{res_entries}

{src_files}
{res_files}
		{proj} /* Project object */ = {{
			isa = PBXProject;
			attributes = {{ LastUpgradeCheck = 1500; }};
			buildConfigurationList = {cfglist_proj};
			compatibilityVersion = "Xcode 14.0";
			developmentRegion = en;
			hasScannedForEncodings = 0;
			knownRegions = (en, Base);
			mainGroup = {main_group};
			productRefGroup = {prod_group};
			projectDirPath = "";
			projectRoot = "";
			targets = ({target});
		}};
		{target} /* FunnyPlus */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {cfglist_target};
			buildPhases = ({sources_phase}, {frameworks_phase}, {resources_phase});
			buildRules = ();
			dependencies = ();
			name = FunnyPlus;
			productName = FunnyPlus;
			productReference = {products_target};
			productType = "com.apple.product-type.application";
		}};
		{main_group} = {{
			isa = PBXGroup;
			children = ({app_group}, {prod_group});
			sourceTree = "<group>";
		}};
		{app_group} = {{
			isa = PBXGroup;
			children = ({ids[files[0]]}, {resids[res[0]]}, {resids[res[1]]});
			path = FunnyPlus;
			sourceTree = "<group>";
		}};
		{prod_group} = {{
			isa = PBXGroup;
			children = ({products_target});
			name = Products;
			sourceTree = "<group>";
		}};
		{products_target} /* FunnyPlus.app */ = {{
			isa = PBXFileReference;
			explicitFileType = wrapper.application;
			includeInIndex = 0;
			path = FunnyPlus.app;
			sourceTree = BUILT_PRODUCTS_DIR;
		}};
		{sources_phase} = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = ({bids[files[0]]});
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{frameworks_phase} = {{
			isa = PBXFrameworksBuildPhase;
			buildActionMask = 2147483647;
			files = ();
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{resources_phase} = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = ({resbids[res[0]]}, {resbids[res[1]]});
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{cfglist_proj} = {{
			isa = XCConfigurationList;
			buildConfigurations = ({cfg_proj_d}, {cfg_proj_r});
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{cfglist_target} = {{
			isa = XCConfigurationList;
			buildConfigurations = ({cfg_t_d}, {cfg_t_r});
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Release;
		}};
		{cfg_proj_d} = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CLANG_ENABLE_OBJC_ARC = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 15.0;
				SDKROOT = iphoneos;
			}};
			name = Debug;
		}};
		{cfg_proj_r} = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CLANG_ENABLE_OBJC_ARC = YES;
				IPHONEOS_DEPLOYMENT_TARGET = 15.0;
				SDKROOT = iphoneos;
			}};
			name = Release;
		}};
		{cfg_t_d} = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGNING_ALLOWED = NO;
				CODE_SIGNING_REQUIRED = NO;
				CODE_SIGN_IDENTITY = "";
				CURRENT_PROJECT_VERSION = 1;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = FunnyPlus/Info.plist;
				LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@executable_path/Frameworks");
				MARKETING_VERSION = 0.1.0;
				OTHER_LDFLAGS = ("-framework", UIKit, "-framework", WebKit);
				PRODUCT_BUNDLE_IDENTIFIER = com.funnyplus.app;
				PRODUCT_NAME = "$(TARGET_NAME)";
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				TARGETED_DEVICE_FAMILY = 1;
			}};
			name = Debug;
		}};
		{cfg_t_r} = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGNING_ALLOWED = NO;
				CODE_SIGNING_REQUIRED = NO;
				CODE_SIGN_IDENTITY = "";
				CURRENT_PROJECT_VERSION = 1;
				GENERATE_INFOPLIST_FILE = NO;
				INFOPLIST_FILE = FunnyPlus/Info.plist;
				LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@executable_path/Frameworks");
				MARKETING_VERSION = 0.1.0;
				OTHER_LDFLAGS = ("-framework", UIKit, "-framework", WebKit);
				PRODUCT_BUNDLE_IDENTIFIER = com.funnyplus.app;
				PRODUCT_NAME = "$(TARGET_NAME)";
				ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
				TARGETED_DEVICE_FAMILY = 1;
			}};
			name = Release;
		}};
	}};
	rootObject = {proj};
}}
'''
os.makedirs('FunnyPlus.xcodeproj', exist_ok=True)
open('FunnyPlus.xcodeproj/project.pbxproj','w').write(pbx)
print('ok')
