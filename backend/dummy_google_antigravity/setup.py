from setuptools import setup, find_namespace_packages

setup(
    name="google-antigravity",
    version="2.0.0",
    packages=find_namespace_packages(include=["google.*"]),
    install_requires=[],
)
