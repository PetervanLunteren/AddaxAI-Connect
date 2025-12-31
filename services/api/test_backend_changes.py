#!/usr/bin/env python3
"""
Test script for backend changes

Run this to validate:
- All new imports work
- All models have correct fields
- All routers are properly configured
- No syntax errors
"""
import sys
import traceback

def test_imports():
    """Test all critical imports"""
    print("Testing imports...")

    try:
        # Test shared models
        from shared.models import Project, User, Camera
        print("  ✓ Shared models import")

        # Test storage constants
        from shared.storage import BUCKET_PROJECT_IMAGES
        print(f"  ✓ Storage constant: {BUCKET_PROJECT_IMAGES}")

        # Test auth dependency
        from auth.project_access import get_accessible_project_ids
        print("  ✓ Project access dependency")

        # Test image processing
        from utils.image_processing import process_and_upload_project_image, delete_project_images
        print("  ✓ Image processing utilities")

        # Test routers
        from routers import projects, admin, cameras, images, statistics, project_images
        print("  ✓ All routers import")

        return True
    except Exception as e:
        print(f"  ✗ Import failed: {e}")
        traceback.print_exc()
        return False


def test_model_fields():
    """Test Project model has new fields"""
    print("\nTesting model fields...")

    try:
        from shared.models import Project

        # Check if Project has new columns
        if hasattr(Project, 'image_path'):
            print("  ✓ Project.image_path exists")
        else:
            print("  ✗ Project.image_path missing")
            return False

        if hasattr(Project, 'thumbnail_path'):
            print("  ✓ Project.thumbnail_path exists")
        else:
            print("  ✗ Project.thumbnail_path missing")
            return False

        return True
    except Exception as e:
        print(f"  ✗ Model test failed: {e}")
        traceback.print_exc()
        return False


def test_router_registration():
    """Test routers are registered"""
    print("\nTesting router registration...")

    try:
        from main import app

        # Get all routes
        routes = [route.path for route in app.routes]

        # Check for new endpoints
        expected_routes = [
            "/api/projects/{project_id}/image",  # Upload/delete image
            "/api/admin/users",  # List users
            "/api/admin/users/{user_id}/project",  # Assign user
        ]

        found_routes = []
        for expected in expected_routes:
            # Match pattern (FastAPI uses path parameters)
            base_path = expected.replace("{project_id}", "").replace("{user_id}", "")
            if any(base_path in route for route in routes):
                found_routes.append(expected)
                print(f"  ✓ Route pattern found: {expected}")
            else:
                print(f"  ✗ Route missing: {expected}")

        return len(found_routes) == len(expected_routes)
    except Exception as e:
        print(f"  ✗ Router test failed: {e}")
        traceback.print_exc()
        return False


def test_pydantic_models():
    """Test Pydantic response models"""
    print("\nTesting Pydantic models...")

    try:
        from routers.projects import ProjectResponse, ProjectDeleteResponse
        from routers.admin import UserResponse, AssignUserToProjectRequest

        # Test ProjectResponse has new fields
        if 'image_url' in ProjectResponse.model_fields:
            print("  ✓ ProjectResponse.image_url defined")
        else:
            print("  ✗ ProjectResponse.image_url missing")
            return False

        if 'thumbnail_url' in ProjectResponse.model_fields:
            print("  ✓ ProjectResponse.thumbnail_url defined")
        else:
            print("  ✗ ProjectResponse.thumbnail_url missing")
            return False

        # Test new models exist
        print("  ✓ ProjectDeleteResponse exists")
        print("  ✓ UserResponse exists")
        print("  ✓ AssignUserToProjectRequest exists")

        return True
    except Exception as e:
        print(f"  ✗ Pydantic model test failed: {e}")
        traceback.print_exc()
        return False


def main():
    """Run all tests"""
    print("=" * 60)
    print("Backend Implementation Validation")
    print("=" * 60)

    results = []

    # Run tests
    results.append(("Imports", test_imports()))
    results.append(("Model Fields", test_model_fields()))
    results.append(("Router Registration", test_router_registration()))
    results.append(("Pydantic Models", test_pydantic_models()))

    # Summary
    print("\n" + "=" * 60)
    print("Test Summary")
    print("=" * 60)

    passed = sum(1 for _, result in results if result)
    total = len(results)

    for name, result in results:
        status = "✓ PASS" if result else "✗ FAIL"
        print(f"{status:8} {name}")

    print(f"\nTotal: {passed}/{total} tests passed")

    if passed == total:
        print("\n🎉 All tests passed! Backend implementation looks good.")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed. Review errors above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
